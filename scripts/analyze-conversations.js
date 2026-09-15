#!/usr/bin/env node
/* eslint-disable */
/**
 * Roda a análise de IA (tela Insights) manualmente, direto do seu computador — pra quem
 * está com o OmniRoute rodando em localhost (não hospedado publicamente numa VPS) e
 * prefere analisar por conta própria (ex: no fim do dia) em vez de deixar em tempo real.
 *
 * Uso: npm run insights:local
 *
 * Diferente do gatilho ao vivo (que só reage a mensagem NOVA a partir do momento em que
 * está no ar — ver src/lib/integrations/persist-event.ts) e do botão "Analisar conversas
 * antigas" da tela (que só preenche conversa nunca analisada — ver
 * /api/ai/backfill-conversations), este script reanalisa qualquer conversa com mensagem
 * mais nova que a última análise salva — exatamente o que faz sentido rodar 1x por dia.
 *
 * Duplica (de propósito, não importa) a lógica de prompt/parsing de src/lib/ai/client.ts:
 * este script roda fora do Next.js (Node puro, sem TypeScript/path aliases), então não dá
 * pra importar aquele módulo diretamente. Se mudar o formato do prompt ou da resposta lá,
 * espelhe a mudança aqui.
 */

try {
  // Node 20.6+ — carrega o .env do projeto sem precisar de dependência extra.
  process.loadEnvFile()
} catch {
  // Sem .env (ou Node mais antigo sem suporte): segue só com o que já estiver em process.env.
}

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
// http://localhost:20128/v1 é o padrão de instalação do OmniRoute — funciona aqui porque
// quem chama é este script rodando na SUA máquina, ao contrário da Vercel (que não
// enxerga seu localhost).
const OMNIROUTE_BASE_URL = (process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128/v1').replace(/\/+$/, '')
const OMNIROUTE_API_KEY = process.env.OMNIROUTE_API_KEY || ''
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL || 'auto/cheap'
const MAX_TRANSCRIPT_MESSAGES = 40

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env — veja .env.example.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

function buildTranscript(rows) {
  return rows
    .map((m) => {
      const who = m.sender_type === 'contact' ? 'Cliente' : m.sender_type === 'user' ? 'Atendente' : 'Sistema'
      const time = new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      const text = (m.content || '').trim() || (m.media_url ? '[mídia enviada]' : '[mensagem vazia]')
      return `[${time}] ${who}: ${text}`
    })
    .join('\n')
}

function buildPrompt(transcript, knownOutcome) {
  const outcomeInstruction = knownOutcome
    ? `Esta negociação JÁ FOI marcada como "${knownOutcome === 'ganha' ? 'GANHA (venda fechada)' : 'PERDIDA (o cliente não fechou)'}" pela própria equipe de vendas. Sua única tarefa aqui é explicar, em até 2 frases curtas e objetivas, o que na conversa parece explicar esse resultado. Não contradiga esse resultado — devolva outcome exatamente como "${knownOutcome}".`
    : 'Avalie, só pelo conteúdo da conversa, se ela já tem um desfecho claro (venda fechada ou cliente que desistiu/recusou) ou se ainda está em aberto.'

  const now = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return `Você está analisando uma conversa de atendimento via WhatsApp/Instagram de uma empresa do ramo fitness ("Quero Ser Fit"), entre um(a) atendente/vendedor(a) da empresa e um cliente.

Data/hora atual: ${now}. Use isso pra avaliar há quanto tempo a conversa está parada — uma última mensagem de vários dias ou meses atrás, sem resposta da empresa, é um sinal forte de risco/abandono, mesmo que o texto em si pareça neutro.

TRANSCRIÇÃO (da mensagem mais antiga para a mais recente):
${transcript}

${outcomeInstruction}

Responda SEMPRE em português, e responda SOMENTE com um objeto JSON válido (sem markdown, sem texto antes ou depois), com exatamente estes campos:

{
  "status": "ok" | "atencao" | "risco",
  "signals": string[],
  "summary": string,
  "outcome": "aberta" | "ganha" | "perdida",
  "outcomeReason": string
}

- status: "risco" se há um problema real e urgente agora (cliente esperando resposta há muito tempo sem retorno, pergunta direta do cliente que ficou sem resposta, cliente demonstrando insatisfação, frustração ou vontade de desistir); "atencao" se há um sinal de alerta mais leve (demora moderada, objeção de preço ainda sem resposta, uma dúvida em aberto); "ok" se o atendimento está fluindo bem, sem nada pendente preocupante.
- signals: lista curta (no máximo 5) de sinais concretos observados na conversa, cada um em poucas palavras (ex: "cliente esperando há mais de 1h", "pergunta sobre preço não respondida", "cliente pediu pra cancelar"). Lista vazia se não houver nada digno de nota.
- summary: um resumo objetivo de 1 a 2 frases sobre o estado atual (ou o desfecho, se já tiver um) da conversa.
- outcome: "ganha" se está claro que o cliente comprou/fechou negócio; "perdida" se está claro que o cliente desistiu, recusou ou cancelou; "aberta" em qualquer outro caso (negociação ainda em andamento, ou sem informação suficiente pra dizer).
- outcomeReason: se outcome for "ganha" ou "perdida", uma frase objetiva do motivo (ex: "fechou o plano trimestral", "achou o preço alto e não retornou", "sumiu sem responder depois da proposta"). String vazia ("") se outcome for "aberta".

Baseie-se SOMENTE no conteúdo da transcrição acima. Nunca invente informação que não está no texto.`
}

function extractJson(raw) {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1] : trimmed
}

function parseResponse(raw, knownOutcome) {
  let parsed
  try {
    parsed = JSON.parse(extractJson(raw))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const status = parsed.status === 'ok' || parsed.status === 'atencao' || parsed.status === 'risco' ? parsed.status : null
  if (!status) return null

  const outcome = knownOutcome ?? (parsed.outcome === 'ganha' || parsed.outcome === 'perdida' || parsed.outcome === 'aberta' ? parsed.outcome : 'aberta')

  const signals = Array.isArray(parsed.signals)
    ? parsed.signals.filter((s) => typeof s === 'string' && s.trim().length > 0).slice(0, 5)
    : []

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 1000) : ''

  const outcomeReasonRaw = typeof parsed.outcomeReason === 'string' ? parsed.outcomeReason.trim() : ''
  const outcomeReason = outcome !== 'aberta' && outcomeReasonRaw ? outcomeReasonRaw.slice(0, 500) : null

  return { status, signals, summary, outcome, outcomeReason }
}

async function analyzeConversation(transcript, knownOutcome) {
  const response = await fetch(`${OMNIROUTE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(OMNIROUTE_API_KEY ? { Authorization: `Bearer ${OMNIROUTE_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: OMNIROUTE_MODEL,
      messages: [{ role: 'user', content: buildPrompt(transcript, knownOutcome) }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  })
  if (!response.ok) {
    throw new Error(`gateway respondeu ${response.status}: ${await response.text().catch(() => '')}`)
  }
  const data = await response.json()
  const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (!raw) return null
  return parseResponse(raw, knownOutcome)
}

async function main() {
  console.log(`Gateway de IA: ${OMNIROUTE_BASE_URL} (modelo: ${OMNIROUTE_MODEL})\n`)

  const { data: conversations, error: convError } = await supabase
    .from('conversations')
    .select('id, organization_id, last_message_at')
    .order('last_message_at', { ascending: true })
  if (convError) {
    console.error('Erro ao buscar conversas:', convError.message)
    process.exit(1)
  }

  const { data: insights, error: insightsError } = await supabase.from('ai_conversation_insights').select('conversation_id, last_analyzed_at')
  if (insightsError) {
    console.error('Erro ao buscar análises já salvas:', insightsError.message)
    process.exit(1)
  }

  const lastAnalyzedByConversation = new Map((insights || []).map((i) => [i.conversation_id, i.last_analyzed_at]))

  // Pendente = nunca analisada, OU tem mensagem mais nova que a última análise salva.
  const pending = (conversations || []).filter((c) => {
    const lastAnalyzed = lastAnalyzedByConversation.get(c.id)
    return !lastAnalyzed || new Date(c.last_message_at) > new Date(lastAnalyzed)
  })

  console.log(`${pending.length} conversa(s) pendente(s) de ${(conversations || []).length} no total.`)
  if (pending.length === 0) {
    console.log('Nada pra fazer — tudo em dia.')
    return
  }

  const conversationIds = pending.map((c) => c.id)
  const { data: dealsRaw } = await supabase.from('deals').select('id, stage, conversation_id').in('conversation_id', conversationIds)
  const dealByConversation = new Map((dealsRaw || []).map((d) => [d.conversation_id, d]))

  const orgIds = [...new Set(pending.map((c) => c.organization_id))]
  const { data: stagesRaw } = await supabase.from('pipeline_stages').select('organization_id, key, is_won, is_lost').in('organization_id', orgIds)
  const stageByOrgKey = new Map((stagesRaw || []).map((s) => [`${s.organization_id}:${s.key}`, s]))

  let done = 0
  let failed = 0
  for (let i = 0; i < pending.length; i++) {
    const conv = pending[i]
    process.stdout.write(`[${i + 1}/${pending.length}] ${conv.id} … `)
    try {
      const { data: messages } = await supabase
        .from('messages')
        .select('id, sender_type, content, media_url, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(MAX_TRANSCRIPT_MESSAGES)
      const rows = (messages || []).slice().reverse()
      if (rows.length === 0) {
        console.log('sem mensagens, pulando.')
        continue
      }

      const deal = dealByConversation.get(conv.id)
      const stage = deal ? stageByOrgKey.get(`${conv.organization_id}:${deal.stage}`) : undefined
      const knownOutcome = stage && stage.is_won ? 'ganha' : stage && stage.is_lost ? 'perdida' : null

      const result = await analyzeConversation(buildTranscript(rows), knownOutcome)
      if (!result) {
        console.log('resposta vazia/inválida da IA, pulando.')
        failed++
        continue
      }

      const lastMessageId = rows[rows.length - 1] ? rows[rows.length - 1].id : null
      const { error: upsertError } = await supabase.from('ai_conversation_insights').upsert(
        {
          organization_id: conv.organization_id,
          conversation_id: conv.id,
          deal_id: deal ? deal.id : null,
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
      if (upsertError) {
        console.log('erro ao salvar:', upsertError.message)
        failed++
        continue
      }

      console.log(`ok (${result.status}${result.outcome !== 'aberta' ? ', ' + result.outcome : ''})`)
      done++
    } catch (err) {
      console.log('erro:', err instanceof Error ? err.message : String(err))
      failed++
    }
  }

  console.log(`\nConcluído: ${done} analisada(s), ${failed} falharam, de ${pending.length} pendente(s).`)
}

main().catch((err) => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
