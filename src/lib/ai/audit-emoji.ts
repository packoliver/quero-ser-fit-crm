import type { AdminClient } from '@/lib/supabase/admin'
import type { AuditMessage } from './audit-model'
import { loadAuditMessages, type AuditRun } from './full-audit'

export interface PaymentEmojiSignal {
  conversationId: string
  evidence: { messageId: string; quote: string; source: 'text' }[]
  attachmentMessageId: string | null
  confidence: 'media' | 'baixa'
  description: string
}

const approvalOnly = /^(?:(?:✅|☑|👍|👌|🙏|❤|🥰|💚|☺|👏|🎉)[\uFE0F\u{1F3FB}-\u{1F3FF}]*\s*)+$/u
export function isApprovalEmoji(text: string | null) { return approvalOnly.test((text || '').trim()) }
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Um sinal contextual não altera o desfecho nem a confirmação financeira da auditoria. */
export function findPaymentEmojiSignals(messages: AuditMessage[], conversationId: string): PaymentEmojiSignal[] {
  const signals: PaymentEmojiSignal[] = []
  for (let index = 1; index < messages.length; index++) {
    const approval = messages[index], previous = messages[index - 1]
    if (approval.sender_type !== 'user' || !isApprovalEmoji(approval.content) || previous.sender_type !== 'contact') continue
    const delay = Date.parse(approval.created_at) - Date.parse(previous.created_at)
    if (!Number.isFinite(delay) || delay < 0 || delay > 86_400_000) continue
    const context = messages.slice(Math.max(0, index - 8), index)
    const pix = context.findLast(message => /\bpix\b/.test(normalize(message.content || '')))
    if (!pix) continue
    const text = normalize(previous.content || '')
    if (/\?|\b(?:nao|ainda|vou|amanha|posso|consegue|aguardando)\b/.test(text)) continue
    const claim = /\b(?:fiz|paguei|pago|enviei|transferi|comprovante)\b/.test(text)
    const attachment = ['image', 'document'].includes(previous.media_type || '')
    if (!claim && !attachment) continue
    const evidence = [pix, previous, approval].filter((item, position, all) => item.content?.trim()
      && all.findIndex(other => other.id === item.id) === position).map(item => ({
      messageId: item.id, quote: (item.content || '').slice(0, 240), source: 'text' as const,
    }))
    signals.push({ conversationId, evidence, attachmentMessageId: attachment ? previous.id : null,
      confidence: claim ? 'media' : 'baixa',
      description: 'O atendente respondeu com emoji após relato de Pix ou possível comprovante. Pode indicar ciência do pagamento; o recebimento no banco e o conteúdo do anexo precisam de conferência.' })
  }
  return signals
}

export async function loadPaymentEmojiSignals(admin: AdminClient, run: AuditRun) {
  const completed = new Set(run.conversations.filter(item => item.state === 'completed').map(item => item.id))
  const candidates = new Set<string>()
  let cursor = ''
  for (;;) {
    let query = admin.from('messages').select('id, conversation_id, content')
      .eq('organization_id', run.organizationId).eq('sender_type', 'user')
      .lte('created_at', run.cutoff).lte('updated_at', run.cutoff)
      .or('content.ilike.%✅%,content.ilike.%👍%,content.ilike.%☑%,content.ilike.%👌%,content.ilike.%🙏%,content.ilike.%❤%,content.ilike.%🥰%,content.ilike.%💚%,content.ilike.%☺%,content.ilike.%👏%,content.ilike.%🎉%').order('id').limit(500)
    if (cursor) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error) throw new Error('Não foi possível conferir os emojis armazenados.')
    const rows = data as { id: string; conversation_id: string; content: string | null }[]
    for (const row of rows) if (completed.has(row.conversation_id) && isApprovalEmoji(row.content)) candidates.add(row.conversation_id)
    if (rows.length < 500) break
    cursor = rows.at(-1)!.id
  }
  const signals: PaymentEmojiSignal[] = []
  const ids = [...candidates]
  for (let offset = 0; offset < ids.length; offset += 6) {
    const groups = await Promise.all(ids.slice(offset, offset + 6).map(async id => {
      const messages = await loadAuditMessages(admin, run.organizationId, id, run.cutoff)
      return findPaymentEmojiSignals(messages.filter(message => !message.updated_at || message.updated_at <= run.cutoff), id)
    }))
    signals.push(...groups.flat())
  }
  return signals
}
