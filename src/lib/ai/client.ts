import { getServerEnv } from '@/lib/env'

// OmniRoute (auto-hospedado pelo usuário — ver https://www.omniroute.online) expõe uma
// API compatível com OpenAI (POST {base}/chat/completions) e roteia por trás dela entre
// vários provedores/modelos. Por isso este cliente fala o formato OpenAI genérico, não
// nenhum SDK específico de um provedor — funciona com OmniRoute hoje e com qualquer outro
// gateway/provedor compatível com OpenAI no futuro, só trocando as env vars abaixo.
//
// "auto/cheap" pede pro próprio OmniRoute escolher a rota mais barata disponível — importa
// porque essa análise roda a cada mensagem trocada em toda conversa da organização, não só
// quando fecha. Trocável sem deploy via OMNIROUTE_MODEL.
const DEFAULT_MODEL = 'auto/cheap'

// 15s: generoso o bastante pra uma resposta normal, mas curto o bastante pra não segurar a
// tarefa em segundo plano (ver `after()` nos pontos que chamam isso) por muito tempo se o
// gateway estiver lento. Como essa análise nunca bloqueia envio/recebimento de mensagem de
// verdade (roda depois da resposta ao usuário), um timeout maior não ajudaria ninguém — só
// atrasaria quando o resultado aparece na tela de Insights.
const TIMEOUT_MS = 15_000

// A pergunta livre ("Pergunte à IA") manda um contexto bem maior (até 400 conversas
// resumidas) do que a análise de uma conversa só — o modelo demora mais pra processar isso
// e responder. 15s se mostrou curto demais na prática (erro "gateway não respondeu" com a
// variável corretamente configurada e o gateway saudável, confirmado por fora). Aqui a
// pessoa já está esperando na tela (loading visível), então vale segurar mais antes de
// desistir — 45s deixa folga sob o maxDuration=60 da rota (ver ask-insights/route.ts).
const QA_TIMEOUT_MS = 45_000

/** Sem OMNIROUTE_BASE_URL configurada, a feature de Insights fica desligada de propósito —
 * nada no resto do CRM depende disso pra funcionar (ver src/lib/ai/insights.ts). */
export function isAiConfigured(): boolean {
  return !!getServerEnv().OMNIROUTE_BASE_URL
}

export interface ConversationAnalysis {
  status: 'ok' | 'atencao' | 'risco'
  signals: string[]
  summary: string
  outcome: 'aberta' | 'ganha' | 'perdida'
  outcomeReason: string | null
}

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tempo esgotado ao chamar o gateway de IA.')), ms)
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

/** Alguns modelos (principalmente os menores/gratuitos que um roteador como o OmniRoute
 * costuma incluir) devolvem o JSON dentro de um bloco de código markdown mesmo quando
 * instruídos a não fazer isso — remove a cerca antes de tentar parsear. */
function extractJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1] : trimmed
}

function parseResponse(raw: string, knownOutcome: 'ganha' | 'perdida' | null): ConversationAnalysis | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(raw))
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

interface ChatCompletionsResponse {
  choices?: { message?: { content?: string } }[]
}

/**
 * Manda a transcrição pra IA e devolve a análise estruturada — ou null em QUALQUER
 * situação de falha (sem gateway configurado, transcrição vazia, erro de rede, resposta
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
  const { OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY, OMNIROUTE_MODEL } = getServerEnv()
  if (!OMNIROUTE_BASE_URL || !transcript.trim()) return null

  try {
    const baseUrl = OMNIROUTE_BASE_URL.replace(/\/+$/, '')
    const response = await withTimeout(
      fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(OMNIROUTE_API_KEY ? { Authorization: `Bearer ${OMNIROUTE_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: OMNIROUTE_MODEL || DEFAULT_MODEL,
          messages: [{ role: 'user', content: buildPrompt(transcript, knownOutcome) }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        }),
      }),
      TIMEOUT_MS
    )

    if (!response.ok) {
      console.error('[ai] Gateway respondeu com erro:', response.status, await response.text().catch(() => ''))
      return null
    }

    const data = (await response.json()) as ChatCompletionsResponse
    const raw = data.choices?.[0]?.message?.content
    if (!raw) return null
    return parseResponse(raw, knownOutcome)
  } catch (err) {
    console.error('[ai] Falha ao analisar conversa:', err)
    return null
  }
}

function buildQaPrompt(context: string, question: string): string {
  const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return `Você é um assistente que responde perguntas sobre o desempenho comercial de uma empresa do ramo fitness ("Quero Ser Fit"), com base em análises de IA já feitas sobre conversas de WhatsApp/Instagram.

Data de hoje: ${today}. Use isso pra interpretar perguntas de período (ex: "essa semana", "esse mês", "hoje") contra a Data de cada linha abaixo, que é a data da ÚLTIMA MENSAGEM daquela conversa.

DADOS (uma linha por conversa analisada — data, cliente, vendedor(a), status, desfecho e resumo):
${context}

PERGUNTA: ${question}

Responda em português, de forma direta e objetiva, citando números quando fizer sentido (quantidades, percentuais). Baseie-se SOMENTE nos dados acima — se a pergunta não puder ser respondida com eles, diga isso claramente em vez de inventar uma resposta.

Responda em TEXTO SIMPLES, sem nenhum símbolo de markdown — nada de **negrito**, # títulos, \`código\` ou listas com * ou -. Quem lê essa resposta está numa tela que mostra texto puro, então esses símbolos apareceriam literalmente e ficariam feios. Se precisar organizar em itens, numere com "1.", "2." etc, cada um em uma linha nova, sem nenhuma outra formatação.`
}

/**
 * Pergunta livre sobre o conjunto de conversas já analisadas (ver
 * src/lib/ai/insights.ts::answerQuestionAboutInsights, que monta o `context`) — devolve
 * texto puro, não JSON estruturado (essa é uma resposta pra pessoa ler, não um dado pra
 * salvar no banco). Mesma postura de falha das outras funções deste arquivo: null em
 * qualquer problema, nunca lança.
 */
export async function askQuestion({ context, question }: { context: string; question: string }): Promise<string | null> {
  const { OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY, OMNIROUTE_MODEL } = getServerEnv()
  if (!OMNIROUTE_BASE_URL || !question.trim() || !context.trim()) return null

  try {
    const baseUrl = OMNIROUTE_BASE_URL.replace(/\/+$/, '')
    const response = await withTimeout(
      fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(OMNIROUTE_API_KEY ? { Authorization: `Bearer ${OMNIROUTE_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: OMNIROUTE_MODEL || DEFAULT_MODEL,
          messages: [{ role: 'user', content: buildQaPrompt(context, question) }],
          temperature: 0.3,
        }),
      }),
      QA_TIMEOUT_MS
    )

    if (!response.ok) {
      console.error('[ai] Gateway respondeu com erro (pergunta livre):', response.status, await response.text().catch(() => ''))
      return null
    }

    const data = (await response.json()) as ChatCompletionsResponse
    const raw = data.choices?.[0]?.message?.content
    return raw ? raw.trim() : null
  } catch (err) {
    console.error('[ai] Falha ao responder pergunta:', err)
    return null
  }
}

// Exportado só pra teste (validação do parsing sem precisar chamar a API de verdade).
export const __testing = { parseResponse, buildPrompt, extractJson, buildQaPrompt }
