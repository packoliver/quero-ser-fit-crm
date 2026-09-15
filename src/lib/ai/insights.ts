import { AdminClient } from '@/lib/supabase/admin'
import { analyzeConversation, isGeminiConfigured } from './gemini'

// Evita chamar a IA de novo a cada mensagem isolada quando várias chegam em sequência
// rápida (ex: cliente mandando 5 áudios seguidos, ou a vendedora respondendo linha por
// linha) — dentro da janela, a chamada é pulada; a PRÓXIMA mensagem que chegar depois do
// cooldown já busca as últimas MAX_TRANSCRIPT_MESSAGES de uma vez, então nada fica de
// fora, só agrupado. Isso é o que faz "monitorar toda mensagem" ser sustentável em custo
// sem precisar de fila/infra nova.
const COOLDOWN_MS = 25_000
const MAX_TRANSCRIPT_MESSAGES = 40

interface MessageRow {
  id: string
  sender_type: string
  content: string | null
  media_url: string | null
  created_at: string
}

export interface ScheduleAnalysisParams {
  conversationId: string
  organizationId: string
  dealId?: string | null
  /** true quando isto foi disparado por um pedido marcado Ganho/Perdido de verdade no
   * Funil (não por uma mensagem nova) — ignora o cooldown e passa o desfecho já
   * conhecido pra IA, que só precisa explicar o motivo (ver knownOutcome). */
  finalize?: boolean
  knownOutcome?: 'ganha' | 'perdida' | null
}

function buildTranscript(rows: MessageRow[]): string {
  return rows
    .map((m) => {
      const who = m.sender_type === 'contact' ? 'Cliente' : m.sender_type === 'user' ? 'Atendente' : 'Sistema'
      const time = new Date(m.created_at).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      const text = m.content?.trim() || (m.media_url ? '[mídia enviada]' : '[mensagem vazia]')
      return `[${time}] ${who}: ${text}`
    })
    .join('\n')
}

async function runAnalysis(admin: AdminClient, params: ScheduleAnalysisParams): Promise<void> {
  const { conversationId, organizationId, dealId, finalize, knownOutcome } = params

  if (!finalize) {
    const { data: existing } = await admin
      .from('ai_conversation_insights')
      .select('last_analyzed_at')
      .eq('conversation_id', conversationId)
      .maybeSingle()
    const lastAnalyzedAt = (existing as { last_analyzed_at: string | null } | null)?.last_analyzed_at
    if (lastAnalyzedAt && Date.now() - new Date(lastAnalyzedAt).getTime() < COOLDOWN_MS) {
      return
    }
  }

  const { data: messages } = await admin
    .from('messages')
    .select('id, sender_type, content, media_url, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_TRANSCRIPT_MESSAGES)

  const rows = ((messages || []) as MessageRow[]).slice().reverse()
  if (rows.length === 0) return

  const result = await analyzeConversation({
    transcript: buildTranscript(rows),
    knownOutcome: finalize ? knownOutcome ?? null : null,
  })
  if (!result) return

  const lastMessageId = rows[rows.length - 1]?.id ?? null

  await admin.from('ai_conversation_insights').upsert(
    {
      organization_id: organizationId,
      conversation_id: conversationId,
      deal_id: dealId ?? null,
      status: result.status,
      signals: result.signals,
      summary: result.summary,
      outcome: result.outcome,
      outcome_reason: result.outcomeReason,
      last_analyzed_message_id: lastMessageId,
      last_analyzed_at: new Date().toISOString(),
    },
    { onConflict: 'conversation_id' }
  )
}

/**
 * Ponto de entrada único pra disparar a análise de IA de uma conversa — chamado de dentro
 * de `after()` (ver next/server) nos pontos onde uma mensagem é persistida ou um pedido
 * fecha, então roda DEPOIS da resposta já ter ido pro navegador, sem atrasar nada. Nunca
 * lança: qualquer falha (sem chave configurada, rede, resposta malformada da IA, erro de
 * banco) é engolida e logada — esta é sempre uma feature auxiliar, nunca pode derrubar o
 * envio de mensagem nem a sincronização de um pedido que dependeram dela por acidente.
 */
export async function scheduleConversationAnalysis(admin: AdminClient, params: ScheduleAnalysisParams): Promise<void> {
  if (!isGeminiConfigured()) return
  try {
    await runAnalysis(admin, params)
  } catch (err) {
    console.error('[insights] Falha ao analisar conversa (ignorada, feature auxiliar):', err)
  }
}

// Exportado só pra teste.
export const __testing = { buildTranscript }
