#!/usr/bin/env node
/* eslint-disable */
/**
 * Versão em terminal da barra "Pergunte à IA" da tela Insights — pra quem está com o
 * OmniRoute só em localhost (ver scripts/analyze-conversations.js). A barra da própria
 * tela roda no servidor da Vercel, que não alcança o localhost do seu computador; este
 * script roda na SUA máquina, então consegue.
 *
 * Uso: npm run insights:ask -- "quantas vendas fechamos essa semana?"
 * (o -- antes da pergunta é necessário pro npm passar o argumento pro script, e não pro
 * próprio npm)
 *
 * Duplica (de propósito, não importa) a lógica de contexto/prompt de src/lib/ai/insights.ts
 * e src/lib/ai/client.ts — mesmo motivo do outro script: roda fora do Next.js, sem os path
 * aliases do TypeScript do projeto. Se mudar o formato lá, espelhe a mudança aqui.
 */

try {
  process.loadEnvFile()
} catch {
  // Sem .env (ou Node mais antigo sem suporte): segue só com o que já estiver em process.env.
}

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const OMNIROUTE_BASE_URL = (process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128/v1').replace(/\/+$/, '')
const OMNIROUTE_API_KEY = process.env.OMNIROUTE_API_KEY || ''
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL || 'auto/cheap'
const MAX_CONTEXT_ROWS = 400

const question = process.argv.slice(2).join(' ').trim()

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env — veja .env.example.')
  process.exit(1)
}
if (!question) {
  console.error('Faltou a pergunta. Uso: npm run insights:ask -- "quantas vendas fechamos essa semana?"')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// Um .in('id', [...]) com centenas de UUIDs estoura o limite de tamanho de cabeçalho HTTP
// (16KB) — confirmado na prática com 400 ids (erro silencioso: a busca voltava vazia, sem
// nome de cliente/vendedor(a) nem data nenhuma no contexto). 100 por lote fica bem abaixo.
const ID_FILTER_CHUNK_SIZE = 100

async function fetchInChunks(ids, fetchChunk) {
  const results = []
  for (let i = 0; i < ids.length; i += ID_FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + ID_FILTER_CHUNK_SIZE)
    const { data } = await fetchChunk(chunk)
    if (data) results.push(...data)
  }
  return results
}

function buildQaContext(rows, contactNameByConversation, sellerNameByDeal, lastMessageAtByConversation) {
  return rows
    .map((r) => {
      const contact = contactNameByConversation.get(r.conversation_id) || 'desconhecido'
      const seller = r.deal_id ? sellerNameByDeal.get(r.deal_id) : null
      const desfecho = r.outcome_reason ? `${r.outcome} (${r.outcome_reason})` : r.outcome
      const lastMessageAt = lastMessageAtByConversation.get(r.conversation_id)
      const data = lastMessageAt ? new Date(lastMessageAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
      return `- Data: ${data} | Cliente: ${contact} | Vendedor(a): ${seller || '—'} | Status: ${r.status} | Desfecho: ${desfecho} | Resumo: ${r.summary || '—'}`
    })
    .join('\n')
}

function buildQaPrompt(context, question) {
  const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `Você é um assistente que responde perguntas sobre o desempenho comercial de uma empresa do ramo fitness ("Quero Ser Fit"), com base em análises de IA já feitas sobre conversas de WhatsApp/Instagram.

Data de hoje: ${today}. Use isso pra interpretar perguntas de período (ex: "essa semana", "esse mês", "hoje") contra a Data de cada linha abaixo, que é a data da ÚLTIMA MENSAGEM daquela conversa.

DADOS (uma linha por conversa analisada — data, cliente, vendedor(a), status, desfecho e resumo):
${context}

PERGUNTA: ${question}

Responda em português, de forma direta e objetiva, citando números quando fizer sentido (quantidades, percentuais). Baseie-se SOMENTE nos dados acima — se a pergunta não puder ser respondida com eles, diga isso claramente em vez de inventar uma resposta.`
}

async function main() {
  console.log(`Gateway de IA: ${OMNIROUTE_BASE_URL} (modelo: ${OMNIROUTE_MODEL})`)
  console.log(`Pergunta: ${question}\n`)

  const { data: insightRows, error: insightsError } = await supabase
    .from('ai_conversation_insights')
    .select('conversation_id, deal_id, status, outcome, outcome_reason, summary')
    .order('last_analyzed_at', { ascending: false })
    .limit(MAX_CONTEXT_ROWS)
  if (insightsError) {
    console.error('Erro ao buscar análises salvas:', insightsError.message)
    process.exit(1)
  }

  const rows = insightRows || []
  if (rows.length === 0) {
    console.log('Nenhuma conversa analisada ainda — rode "npm run insights:local" primeiro.')
    return
  }

  const conversationIds = [...new Set(rows.map((r) => r.conversation_id))]
  const dealIds = [...new Set(rows.map((r) => r.deal_id).filter(Boolean))]

  const [conversations, deals] = await Promise.all([
    fetchInChunks(conversationIds, (chunk) => supabase.from('conversations').select('id, contact_id, last_message_at').in('id', chunk)),
    fetchInChunks(dealIds, (chunk) => supabase.from('deals').select('id, assigned_to_id').in('id', chunk)),
  ])
  const contactIds = [...new Set(conversations.map((c) => c.contact_id))]
  const lastMessageAtByConversation = new Map(conversations.map((c) => [c.id, c.last_message_at]))

  const sellerIds = [...new Set(deals.map((d) => d.assigned_to_id).filter(Boolean))]
  const [contacts, profiles] = await Promise.all([
    fetchInChunks(contactIds, (chunk) => supabase.from('contacts').select('id, name').in('id', chunk)),
    fetchInChunks(sellerIds, (chunk) => supabase.from('profiles').select('id, full_name').in('id', chunk)),
  ])

  const contactNameById = new Map(contacts.map((c) => [c.id, c.name]))
  const contactIdByConversation = new Map(conversations.map((c) => [c.id, c.contact_id]))
  const contactNameByConversation = new Map(
    [...contactIdByConversation.entries()].map(([convId, contactId]) => [convId, contactNameById.get(contactId) || 'desconhecido'])
  )
  const sellerNameById = new Map(profiles.map((p) => [p.id, p.full_name]))
  const sellerNameByDeal = new Map(deals.map((d) => [d.id, d.assigned_to_id ? sellerNameById.get(d.assigned_to_id) || '' : '']))

  const context = buildQaContext(rows, contactNameByConversation, sellerNameByDeal, lastMessageAtByConversation)

  const response = await fetch(`${OMNIROUTE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(OMNIROUTE_API_KEY ? { Authorization: `Bearer ${OMNIROUTE_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: OMNIROUTE_MODEL,
      messages: [{ role: 'user', content: buildQaPrompt(context, question) }],
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    console.error(`Gateway respondeu ${response.status}:`, await response.text().catch(() => ''))
    process.exit(1)
  }

  const data = await response.json()
  const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (!answer) {
    console.error('Resposta vazia da IA.')
    process.exit(1)
  }

  console.log(`Resposta (baseada em ${rows.length} conversa(s) analisada(s)):\n`)
  console.log(answer.trim())
}

main().catch((err) => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
