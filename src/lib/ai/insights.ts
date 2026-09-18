import { AdminClient } from '@/lib/supabase/admin'
import { analyzeConversation, askQuestion, isAiConfigured } from './client'

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
  if (!isAiConfigured()) return
  try {
    await runAnalysis(admin, params)
  } catch (err) {
    console.error('[insights] Falha ao analisar conversa (ignorada, feature auxiliar):', err)
  }
}

// Teto de quantas conversas (as mais recentes, por atividade real — ver order by
// last_message_at abaixo) entram no contexto da pergunta livre, pra não estourar
// tokens/tempo à toa numa organização enorme. 2000 dá folga generosa pro ritmo atual desta
// organização (~700 conversas no primeiro mês) cobrir uns 3 meses de histórico sem cortar
// nada — se crescer muito além disso, é hora de repensar o teto (ou resumir em vez de
// listar linha a linha), mas não antes.
const MAX_QA_CONTEXT_ROWS = 2000

// Um .in('id', [...]) com centenas de UUIDs estoura o limite de tamanho de cabeçalho HTTP
// (16KB) — confirmado na prática com 400 ids (~15.7KB de URL, erro silencioso: o Supabase
// devolve null/erro e o código seguia como se a busca tivesse voltado vazia, sem nome de
// cliente/vendedor(a) nem data nenhuma no contexto). 100 por lote fica bem abaixo do teto.
const ID_FILTER_CHUNK_SIZE = 100

// PromiseLike (não Promise) de propósito: o query builder do Supabase é "thenable"
// (funciona com await) mas não implementa a interface Promise completa (sem .catch,
// .finally) — exigir Promise aqui rejeitaria a chamada direta a `admin.from(...).in(...)`.
async function fetchInChunks<T>(ids: string[], fetchChunk: (chunkIds: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < ids.length; i += ID_FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + ID_FILTER_CHUNK_SIZE)
    const { data } = await fetchChunk(chunk)
    if (data) results.push(...data)
  }
  return results
}

interface QaInsightRow {
  conversation_id: string
  deal_id: string | null
  status: string
  outcome: string
  outcome_reason: string | null
  summary: string | null
}

function buildQaContext(
  rows: QaInsightRow[],
  contactNameByConversation: Map<string, string>,
  sellerNameByDeal: Map<string, string>,
  lastMessageAtByConversation: Map<string, string>
): string {
  return rows
    .map((r) => {
      const contact = contactNameByConversation.get(r.conversation_id) || 'desconhecido'
      const seller = r.deal_id ? sellerNameByDeal.get(r.deal_id) : null
      const desfecho = r.outcome_reason ? `${r.outcome} (${r.outcome_reason})` : r.outcome
      // Data da ÚLTIMA MENSAGEM da conversa (não de quando a IA analisou) — é o que
      // permite responder pergunta de período ("essa semana", "esse mês"). Usar a data da
      // análise em vez disso ficaria errado pra qualquer conversa antiga processada pelo
      // backfill: todas apareceriam com a mesma data (a do dia em que o backfill rodou).
      const lastMessageAt = lastMessageAtByConversation.get(r.conversation_id)
      const data = lastMessageAt
        ? new Date(lastMessageAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '—'
      return `- Data: ${data} | Cliente: ${contact} | Vendedor(a): ${seller || '—'} | Status: ${r.status} | Desfecho: ${desfecho} | Resumo: ${r.summary || '—'}`
    })
    .join('\n')
}

export type QaResult =
  | { ok: true; answer: string; consideredCount: number }
  | { ok: false; reason: 'not_configured' | 'no_data' | 'gateway_failed' }

/**
 * Responde uma pergunta livre (ex: "quantas vendas fechamos essa semana?") com base em
 * todas as conversas já analisadas da organização — não nas mensagens brutas, que
 * estourariam contexto/custo rápido, mas no resumo compacto que cada análise já produz.
 * `reason` no retorno distingue os 3 jeitos de falhar (ver QaResult) — sem isso, "IA não
 * configurada" e "gateway não respondeu" pareciam o mesmo erro genérico pra quem via a
 * mensagem na tela, tornando impossível saber qual dos dois estava acontecendo de verdade.
 */
export async function answerQuestionAboutInsights(admin: AdminClient, organizationId: string, question: string): Promise<QaResult> {
  if (!isAiConfigured()) return { ok: false, reason: 'not_configured' }

  // Ordena por ATIVIDADE DA CONVERSA (last_message_at), não por quando a IA analisou
  // (last_analyzed_at) — os dois divergem bastante logo depois de um backfill, porque ele
  // processa em lotes ao longo de vários dias/execuções sem relação nenhuma com a data de
  // cada conversa em si. Ordenar pelo campo errado já deixou de fora, sem avisar, um trecho
  // inteiro do meio do histórico (perguntas por período, tipo "últimos 30 dias", vinham
  // com um recorte de datas menor e errado).
  const { data: recentConversations } = await admin
    .from('conversations')
    .select('id, contact_id, last_message_at')
    .eq('organization_id', organizationId)
    .order('last_message_at', { ascending: false })
    .limit(MAX_QA_CONTEXT_ROWS)

  const conversations = (recentConversations || []) as { id: string; contact_id: string; last_message_at: string }[]
  if (conversations.length === 0) return { ok: false, reason: 'no_data' }

  const conversationIds = conversations.map((c) => c.id)

  const insightRowsRaw = await fetchInChunks(conversationIds, (chunk) =>
    admin
      .from('ai_conversation_insights')
      .select('conversation_id, deal_id, status, outcome, outcome_reason, summary')
      .in('conversation_id', chunk)
  )
  const rows = insightRowsRaw as QaInsightRow[]
  if (rows.length === 0) return { ok: false, reason: 'no_data' }

  const dealIds = [...new Set(rows.map((r) => r.deal_id).filter((id): id is string => !!id))]

  const deals = (await fetchInChunks(dealIds, (chunk) => admin.from('deals').select('id, assigned_to_id').in('id', chunk))) as {
    id: string
    assigned_to_id: string | null
  }[]

  const lastMessageAtByConversation = new Map(conversations.map((c) => [c.id, c.last_message_at]))

  const contactIds = [...new Set(conversations.map((c) => c.contact_id))]
  const sellerIds = [...new Set(deals.map((d) => d.assigned_to_id).filter((id): id is string => !!id))]

  const [contacts, profiles] = await Promise.all([
    fetchInChunks(contactIds, (chunk) => admin.from('contacts').select('id, name').in('id', chunk)) as Promise<
      { id: string; name: string }[]
    >,
    fetchInChunks(sellerIds, (chunk) => admin.from('profiles').select('id, full_name').in('id', chunk)) as Promise<
      { id: string; full_name: string }[]
    >,
  ])

  const contactNameById = new Map(contacts.map((c) => [c.id, c.name]))
  const contactIdByConversation = new Map(conversations.map((c) => [c.id, c.contact_id]))
  const contactNameByConversation = new Map(
    [...contactIdByConversation.entries()].map(([convId, contactId]) => [convId, contactNameById.get(contactId) || 'desconhecido'])
  )

  const sellerNameById = new Map(profiles.map((p) => [p.id, p.full_name]))
  const sellerNameByDeal = new Map(
    deals.map((d) => [d.id, d.assigned_to_id ? sellerNameById.get(d.assigned_to_id) || '' : ''])
  )

  const context = buildQaContext(rows, contactNameByConversation, sellerNameByDeal, lastMessageAtByConversation)
  const answer = await askQuestion({ context, question })
  if (!answer) return { ok: false, reason: 'gateway_failed' }

  return { ok: true, answer, consideredCount: rows.length }
}

/**
 * Salva uma pergunta+resposta no histórico persistido (tabela ai_qa_history) — chamado
 * tanto pela rota web (/api/ai/ask-insights) quanto pelo script local
 * (scripts/ask-insights.js), os dois únicos lugares que geram uma resposta pra guardar.
 * Nunca lança: um histórico que falhou ao salvar não deve fazer a pessoa perder a resposta
 * que já recebeu na tela — só fica de fora do histórico dessa vez.
 */
export async function saveQaHistory(
  admin: AdminClient,
  params: { organizationId: string; askedBy: string | null; question: string; answer: string; consideredCount: number }
): Promise<void> {
  try {
    await admin.from('ai_qa_history').insert({
      organization_id: params.organizationId,
      asked_by: params.askedBy,
      question: params.question,
      answer: params.answer,
      considered_count: params.consideredCount,
    })
  } catch (err) {
    console.error('[insights] Falha ao salvar histórico de pergunta (ignorada):', err)
  }
}

// Exportado só pra teste.
export const __testing = { buildTranscript, buildQaContext, fetchInChunks, ID_FILTER_CHUNK_SIZE }
