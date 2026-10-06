import type { AdminClient } from '@/lib/supabase/admin'

export interface InsightListRow {
  id: string; conversation_id: string; deal_id: string | null; status: string; signals: unknown
  summary: string | null; outcome: string; outcome_reason: string | null; last_analyzed_at: string | null
  conversations: { last_message_at: string | null; channel_type: string;
    contacts: { name: string; phone: string | null } | null } | null
}
export async function loadInsightList(admin: AdminClient, organizationId: string) {
  const raw: InsightListRow[] = []
  let cursor: string | null = null
  for (;;) {
    let query = admin.from('ai_conversation_insights')
      .select('id, conversation_id, deal_id, status, signals, summary, outcome, outcome_reason, last_analyzed_at, conversations!inner(last_message_at, channel_type, contacts(name, phone))')
      .eq('organization_id', organizationId).order('conversation_id').limit(500)
    if (cursor) query = query.gt('conversation_id', cursor)
    const { data, error } = await query
    if (error) throw new Error('Não foi possível carregar os indicadores.')
    const rows = data as unknown as InsightListRow[]
    raw.push(...rows)
    if (rows.length < 500) break
    cursor = rows.at(-1)!.conversation_id
  }
  const dealIds = [...new Set(raw.flatMap(row => row.deal_id ? [row.deal_id] : []))]
  const deals: { id: string; title: string; value: number | null; assigned_to_id: string | null }[] = []
  for (let offset = 0; offset < dealIds.length; offset += 100) {
    const { data, error } = await admin.from('deals').select('id, title, value, assigned_to_id')
      .eq('organization_id', organizationId).in('id', dealIds.slice(offset, offset + 100))
    if (error) throw new Error('Não foi possível carregar negociações dos indicadores.')
    deals.push(...data)
  }
  const sellerIds = [...new Set(deals.flatMap(deal => deal.assigned_to_id ? [deal.assigned_to_id] : []))]
  const names = new Map<string, string>()
  // Somente membros desta empresa; profiles não possui organization_id.
  for (let offset = 0; offset < sellerIds.length; offset += 100) {
    const { data, error } = await admin.from('organization_members').select('user_id, profiles(full_name)')
      .eq('organization_id', organizationId).in('user_id', sellerIds.slice(offset, offset + 100))
    if (error) throw new Error('Não foi possível carregar responsáveis pelos indicadores.')
    for (const member of data as unknown as { user_id: string; profiles: { full_name: string } | null }[]) {
      if (member.profiles) names.set(member.user_id, member.profiles.full_name)
    }
  }
  const dealsById = new Map(deals.map(deal => [deal.id, deal]))
  return raw.map(row => {
    const deal = row.deal_id ? dealsById.get(row.deal_id) : null
    return { id: row.id, conversationId: row.conversation_id, dealId: row.deal_id, status: row.status,
      signals: Array.isArray(row.signals) ? row.signals.filter(signal => typeof signal === 'string') : [],
      summary: row.summary, outcome: row.outcome, outcomeReason: row.outcome_reason,
      lastAnalyzedAt: row.last_analyzed_at, lastMessageAt: row.conversations?.last_message_at ?? null,
      channelType: row.conversations?.channel_type ?? '', contactName: row.conversations?.contacts?.name || 'Contato sem nome',
      contactPhone: row.conversations?.contacts?.phone ?? null, dealTitle: deal?.title ?? null, dealValue: deal?.value ?? null,
      sellerName: deal?.assigned_to_id ? names.get(deal.assigned_to_id) ?? null : null }
  }).sort((a, b) => (b.lastAnalyzedAt || '').localeCompare(a.lastAnalyzedAt || ''))
}
