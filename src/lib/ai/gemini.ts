import { GoogleGenAI } from '@google/genai'
import { getServerEnv } from '@/lib/env'

// gemini-2.5-flash-lite é o modelo mais barato/rápido ainda estável no catálogo do Google
// (ver https://ai.google.dev/gemini-api/docs/pricing) — importa porque essa análise roda
// a cada mensagem trocada em toda conversa da organização, não só quando fecha. Trocável
// sem deploy via a env var GEMINI_MODEL, caso a qualidade não seja suficiente e valha a
// pena pagar mais por um modelo mais novo.
const DEFAULT_MODEL = 'gemini-2.5-flash-lite'

// 15s: generoso o bastante pra uma resposta normal da API, mas curto o bastante pra não
// segurar a tarefa em segundo plano (ver `after()` nos pontos que chamam isso) por muito
// tempo se o Google estiver lento. Como essa análise nunca bloqueia envio/recebimento de
// mensagem de verdade (roda depois da resposta ao usuário), um timeout maior não ajudaria
// ninguém — só atrasaria quando o resultado aparece na tela de Insights.
const TIMEOUT_MS = 15_000

let cachedClient: GoogleGenAI | null | undefined // undefined = ainda não checou; null = sem chave configurada

function getClient(): GoogleGenAI | null {
  if (cachedClient !== undefined) return cachedClient
  const { GEMINI_API_KEY } = getServerEnv()
  cachedClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null
  return cachedClient
}

/** Sem GEMINI_API_KEY configurada, a feature de Insights fica desligada de propósito —
 * nada no resto do CRM depende disso pra funcionar (ver src/lib/ai/insights.ts). */
export function isGeminiConfigured(): boolean {
  return getClient() !== null
}

export interface ConversationAnalysis {
  status: 'ok' | 'atencao' | 'risco'
  signals: string[]
  summary: string
  outcome: 'aberta' | 'ganha' | 'perdida'
  outcomeReason: string | null
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'atencao', 'risco'] },
    signals: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    outcome: { type: 'string', enum: ['aberta', 'ganha', 'perdida'] },
    // String vazia em vez de null: schema mais simples de validar no lado do Gemini
    // (evita depender de suporte a tipo nullable) — vira null de novo ao salvar no banco.
    outcomeReason: { type: 'string' },
  },
  required: ['status', 'signals', 'summary', 'outcome', 'outcomeReason'],
} as const

function buildPrompt(transcript: string, knownOutcome: 'ganha' | 'perdida' | null): string {
  const outcomeInstruction = knownOutcome
    ? `Esta negociação JÁ FOI marcada como "${knownOutcome === 'ganha' ? 'GANHA (venda fechada)' : 'PERDIDA (o cliente não fechou)'}" pela própria equipe de vendas. Sua única tarefa aqui é explicar, em até 2 frases curtas e objetivas, o que na conversa parece explicar esse resultado. Não contradiga esse resultado — devolva outcome exatamente como "${knownOutcome}".`
    : 'Avalie, só pelo conteúdo da conversa, se ela já tem um desfecho claro (venda fechada ou cliente que desistiu/recusou) ou se ainda está em aberto.'

  // Data/hora atual explícita: sem isso a IA não tem como saber se a última mensagem foi
  // há 10 minutos ou há 3 meses — crítico pro backfill de conversas antigas (ver
  // /api/ai/backfill-conversations), onde a "última mensagem" da transcrição pode ser de
  // muito tempo atrás e isso PRECISA contar como sinal de risco/abandono.
  const now = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return `Você está analisando uma conversa de atendimento via WhatsApp/Instagram de uma empresa do ramo fitness ("Quero Ser Fit"), entre um(a) atendente/vendedor(a) da empresa e um cliente.

Data/hora atual: ${now}. Use isso pra avaliar há quanto tempo a conversa está parada — uma última mensagem de vários dias ou meses atrás, sem resposta da empresa, é um sinal forte de risco/abandono, mesmo que o texto em si pareça neutro.

TRANSCRIÇÃO (da mensagem mais antiga para a mais recente):
${transcript}

${outcomeInstruction}

Responda SEMPRE em português, preenchendo:

- status: "risco" se há um problema real e urgente agora (cliente esperando resposta há muito tempo sem retorno, pergunta direta do cliente que ficou sem resposta, cliente demonstrando insatisfação, frustração ou vontade de desistir); "atencao" se há um sinal de alerta mais leve (demora moderada, objeção de preço ainda sem resposta, uma dúvida em aberto); "ok" se o atendimento está fluindo bem, sem nada pendente preocupante.
- signals: lista curta (no máximo 5) de sinais concretos observados na conversa, cada um em poucas palavras (ex: "cliente esperando há mais de 1h", "pergunta sobre preço não respondida", "cliente pediu pra cancelar"). Lista vazia se não houver nada digno de nota.
- summary: um resumo objetivo de 1 a 2 frases sobre o estado atual (ou o desfecho, se já tiver um) da conversa.
- outcome: "ganha" se está claro que o cliente comprou/fechou negócio; "perdida" se está claro que o cliente desistiu, recusou ou cancelou; "aberta" em qualquer outro caso (negociação ainda em andamento, ou sem informação suficiente pra dizer).
- outcomeReason: se outcome for "ganha" ou "perdida", uma frase objetiva do motivo (ex: "fechou o plano trimestral", "achou o preço alto e não retornou", "sumiu sem responder depois da proposta"). String vazia ("") se outcome for "aberta".

Baseie-se SOMENTE no conteúdo da transcrição acima. Nunca invente informação que não está no texto.`
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tempo esgotado ao chamar a API do Gemini.')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function parseResponse(raw: string, knownOutcome: 'ganha' | 'perdida' | null): ConversationAnalysis | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>

  const status = p.status === 'ok' || p.status === 'atencao' || p.status === 'risco' ? p.status : null
  if (!status) return null

  // Quando o desfecho já é conhecido (finalize=true), ele é a verdade — não a resposta da
  // IA, que só está aqui pra explicar o "porquê", não pra decidir o "o quê".
  const outcome = knownOutcome ?? (p.outcome === 'ganha' || p.outcome === 'perdida' || p.outcome === 'aberta' ? p.outcome : 'aberta')

  const signals = Array.isArray(p.signals)
    ? p.signals.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 5)
    : []

  const summary = typeof p.summary === 'string' ? p.summary.trim().slice(0, 1000) : ''

  const outcomeReasonRaw = typeof p.outcomeReason === 'string' ? p.outcomeReason.trim() : ''
  const outcomeReason = outcome !== 'aberta' && outcomeReasonRaw ? outcomeReasonRaw.slice(0, 500) : null

  return { status, signals, summary, outcome, outcomeReason }
}

/**
 * Manda a transcrição pra IA e devolve a análise estruturada — ou null em QUALQUER
 * situação de falha (sem chave configurada, transcrição vazia, erro de rede, resposta
 * malformada, timeout). Nunca lança: quem chama trata null como "não deu pra analisar
 * agora" e segue em frente — essa é uma feature auxiliar, nunca deve derrubar o envio de
 * mensagem nem a sincronização de um pedido.
 */
export async function analyzeConversation({
  transcript,
  knownOutcome,
}: {
  transcript: string
  knownOutcome: 'ganha' | 'perdida' | null
}): Promise<ConversationAnalysis | null> {
  const ai = getClient()
  if (!ai || !transcript.trim()) return null

  try {
    const model = getServerEnv().GEMINI_MODEL || DEFAULT_MODEL
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: buildPrompt(transcript, knownOutcome),
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_SCHEMA,
        },
      }),
      TIMEOUT_MS
    )

    const raw = response.text
    if (!raw) return null
    return parseResponse(raw, knownOutcome)
  } catch (err) {
    console.error('[gemini] Falha ao analisar conversa:', err)
    return null
  }
}

// Exportado só pra teste (validação do parsing sem precisar chamar a API de verdade).
export const __testing = { parseResponse, buildPrompt }
