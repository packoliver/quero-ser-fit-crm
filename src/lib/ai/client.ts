import { z } from 'zod'
import { getServerEnv } from '@/lib/env'
import { createClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/security/encryption'

// Cache simples pra evitar buscar a config da org em toda chamada de análise
// (a análise roda a cada mensagem trocada). TTL curto (5 min) garante que
// mudanças no painel admin sejam refletidas rapidamente sem sobrecarregar o banco.
let orgAiConfigCache: { organizationId: string; url: string | null; key: string | null; model: string | null; ts: number } | null = null
const ORG_AI_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Lê as configurações de IA da organização diretamente do banco, com fallback
 * para as env vars globais (OMNIROUTE_*). Prioridade: org > env var > null.
 * A API key é descriptografada aqui (server-side only) — nunca trafega pro browser.
 */
async function getOrgAiConfig(organizationId: string): Promise<{ baseUrl: string | null; apiKey: string | null; model: string | null }> {
  const env = getServerEnv()
  const fallback = {
    baseUrl: env.OMNIROUTE_BASE_URL || null,
    apiKey: env.OMNIROUTE_API_KEY || null,
    model: env.OMNIROUTE_MODEL || null,
  }

  // Se não tem Supabase configurado, usa só env vars
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fallback

  // Cache hit
  if (orgAiConfigCache?.organizationId === organizationId && Date.now() - orgAiConfigCache.ts < ORG_AI_CACHE_TTL_MS) {
    return {
      baseUrl: orgAiConfigCache.url ?? fallback.baseUrl,
      apiKey: orgAiConfigCache.key ?? fallback.apiKey,
      model: orgAiConfigCache.model ?? fallback.model,
    }
  }

  try {
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await supabase
      .from('organizations')
      .select('ai_gateway_url, ai_gateway_api_key_encrypted, ai_gateway_model')
      .eq('id', organizationId)
      .maybeSingle()

    if (error || !data) return fallback

    let decryptedKey: string | null = null
    if (data.ai_gateway_api_key_encrypted) {
      try {
        decryptedKey = decryptToken(data.ai_gateway_api_key_encrypted)
      } catch {
        console.warn('[ai] Falha ao descriptografar API key da org — usando fallback.')
      }
    }

    orgAiConfigCache = {
      organizationId,
      url: data.ai_gateway_url,
      key: decryptedKey,
      model: data.ai_gateway_model,
      ts: Date.now(),
    }

    return {
      baseUrl: data.ai_gateway_url ?? fallback.baseUrl,
      apiKey: decryptedKey ?? fallback.apiKey,
      model: data.ai_gateway_model ?? fallback.model,
    }
  } catch (err) {
    console.warn('[ai] Erro ao buscar config de IA da org:', err)
    return fallback
  }
}

// Schema Zod para validação rigorosa da resposta da IA — garante que apenas payloads
// conformes cheguem ao banco. Respostas fora do contrato são descartadas (null) em vez
// de persistir dados malformados ou alucinações estruturais. O preprocess em signals
// filtra valores não-string (null, number, etc.) que modelos menores às vezes devolvem,
// evitando rejeição total do payload por itens inválidos num campo opcional. O limite
// de 5 sinais é aplicado no pós-processamento para permitir truncamento seguro.
const conversationAnalysisSchema = z.object({
  status: z.enum(['ok', 'atencao', 'risco']),
  signals: z.preprocess(
    (val) => (Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : []),
    z.array(z.string()).default([])
  ),
  summary: z.string().max(1000).default(''),
  outcome: z.enum(['aberta', 'ganha', 'perdida']).default('aberta'),
  outcomeReason: z.string().max(500).nullable().optional(),
})

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

// Relatórios sobre centenas de conversas podem levar mais de 45s no provedor.
// Mantém margem abaixo dos 120s do proxy e dos 150s da rota da Vercel.
const QA_TIMEOUT_MS = 115_000

/** Sem gateway configurado (nem na org nem nas env vars), a feature de Insights fica
 * desligada de propósito — nada no resto do CRM depende disso pra funcionar
 * (ver src/lib/ai/insights.ts). Assíncrona porque lê config da org do banco. */
export async function isAiConfigured(organizationId: string): Promise<boolean> {
  const cfg = await getOrgAiConfig(organizationId)
  return !!cfg.baseUrl
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
    console.warn('[ai] Resposta da IA não é JSON válido — descartada.')
    return null
  }

  const validation = conversationAnalysisSchema.safeParse(parsed)
  if (!validation.success) {
    console.warn('[ai] Resposta da IA falhou na validação Zod — descartada.', {
      issues: validation.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
    return null
  }

  const { status, signals, summary, outcome: rawOutcome, outcomeReason: rawReason } = validation.data

  // Quando o desfecho já é conhecido (finalize=true), ele é a verdade — não a resposta da
  // IA, que só está aqui pra explicar o "porquê", não pra decidir o "o quê".
  const outcome = knownOutcome ?? rawOutcome

  // Filtra sinais vazios que podem ter passado pelo schema (strings só com espaço) e
  // garante o limite de 5 mesmo se o default do Zod tiver sido aplicado sobre array maior.
  const cleanedSignals = signals
    .filter((s) => s.trim().length > 0)
    .slice(0, 5)

  const outcomeReason = outcome !== 'aberta' && rawReason && rawReason.trim().length > 0
    ? rawReason.trim().slice(0, 500)
    : null

  return {
    status,
    signals: cleanedSignals,
    summary: summary.trim(),
    outcome,
    outcomeReason,
  }
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
  organizationId,
  transcript,
  knownOutcome,
}: {
  organizationId: string
  transcript: string
  knownOutcome: 'ganha' | 'perdida' | null
}): Promise<ConversationAnalysis | null> {
  const cfg = await getOrgAiConfig(organizationId)
  if (!cfg.baseUrl || !transcript.trim()) return null

  try {
    const baseUrl = cfg.baseUrl.replace(/\/+$/, '')
    const response = await withTimeout(
      fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model || DEFAULT_MODEL,
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

Se a pessoa pedir uma análise ou relatório, apresente a análise agora com os dados disponíveis, em até 8 parágrafos curtos. Não se limite a confirmar que pode fazer isso. Os dados são resumos de conversas já analisadas, não transcrições completas; não afirme ter lido mensagens que não estão nos dados. Use os totais calculados quando estiverem disponíveis.

Responda em TEXTO SIMPLES, sem nenhum símbolo de markdown — nada de **negrito**, # títulos, \`código\` ou listas com * ou -. Quem lê essa resposta está numa tela que mostra texto puro, então esses símbolos apareceriam literalmente e ficariam feios. Se precisar organizar em itens, numere com "1.", "2." etc, cada um em uma linha nova, sem nenhuma outra formatação.`
}

/**
 * Pergunta livre sobre o conjunto de conversas já analisadas (ver
 * src/lib/ai/insights.ts::answerQuestionAboutInsights, que monta o `context`) — devolve
 * texto puro, não JSON estruturado (essa é uma resposta pra pessoa ler, não um dado pra
 * salvar no banco). Mesma postura de falha das outras funções deste arquivo: null em
 * qualquer problema, nunca lança.
 */
export async function askQuestion({ organizationId, context, question }: { organizationId: string; context: string; question: string }): Promise<string | null> {
  const cfg = await getOrgAiConfig(organizationId)
  if (!cfg.baseUrl || !question.trim() || !context.trim()) return null

  const controller = new AbortController()
  try {
    const baseUrl = cfg.baseUrl.replace(/\/+$/, '')
    return await withTimeout((async () => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model || DEFAULT_MODEL,
          messages: [{ role: 'user', content: buildQaPrompt(context, question) }],
          temperature: 0.3,
        }),
      })

      if (!response.ok) {
        console.error('[ai] Gateway respondeu com erro (pergunta livre):', response.status, await response.text().catch(() => ''))
        return null
      }

      const data = (await response.json()) as ChatCompletionsResponse
      const raw = data.choices?.[0]?.message?.content
      return raw ? raw.trim() : null
    })(), QA_TIMEOUT_MS)
  } catch (err) {
    console.error('[ai] Falha ao responder pergunta:', err)
    return null
  } finally {
    // Cancela também a leitura do corpo; o limite deve cobrir a resposta inteira.
    controller.abort()
  }
}

/** Auditoria em lotes: o chamador valida o JSON e as referências contra as mensagens reais. */
function auditGatewayFailure(response: Response, kind: 'text' | 'image' | 'audio') {
  const raw = response.headers?.get('retry-after')
  const seconds = raw ? (/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000) : 300
  return Object.assign(new Error(`Gateway da auditoria retornou HTTP ${response.status}.`), {
    auditGatewayStatus: response.status, auditGatewayKind: kind,
    retryAfterSeconds: Number.isFinite(seconds) ? Math.min(86400, Math.max(1, Math.ceil(seconds))) : 300,
  })
}
export async function requestAuditJson(organizationId: string, instruction: string, input: unknown, image?: { mime: string; base64: string }): Promise<unknown> {
  const cfg = await getOrgAiConfig(organizationId)
  if (!cfg.baseUrl) throw new Error('Gateway de auditoria não configurado.')
  const env = getServerEnv()
  const controller = new AbortController()
  try {
    return await withTimeout((async () => {
      const primary = image ? env.OMNIROUTE_IMAGE_MODEL || 'groq/qwen/qwen3.8-27b'
        : env.OMNIROUTE_AUDIT_MODEL || cfg.model || DEFAULT_MODEL
      // A rota direta preserva o binário quando um combo não encaminha visão corretamente.
      const models = [...new Set([primary, ...(image && env.OMNIROUTE_IMAGE_FALLBACK_MODEL ? [env.OMNIROUTE_IMAGE_FALLBACK_MODEL] : [])])]
      for (const [index, model] of models.entries()) {
        const attempt = new AbortController()
        const timer = models.length > 1 ? setTimeout(() => attempt.abort(), 35_000) : null
        try {
          const response = await fetch(`${cfg.baseUrl!.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST', signal: AbortSignal.any([controller.signal, attempt.signal]),
            headers: { 'Content-Type': 'application/json', 'X-OmniRoute-No-Cache': 'true', 'x-omniroute-no-memory': 'true',
              ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
            body: JSON.stringify({
              model,
              messages: [{ role: 'system', content: instruction }, { role: 'user', content: image
                ? [{ type: 'text', text: `Responda com JSON conforme as instruções. Dados:\n${JSON.stringify(input)}` }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } }]
                : `Responda com JSON conforme as instruções. Dados:\n${JSON.stringify(input)}` }],
              response_format: { type: 'json_object' }, temperature: 0.1,
            }),
          })
          if (!response.ok) throw auditGatewayFailure(response, image ? 'image' : 'text')
          const data = await response.json() as ChatCompletionsResponse
          const content = data.choices?.[0]?.message?.content
          if (!content) throw new Error('Gateway da auditoria devolveu resposta vazia.')
          const result = JSON.parse(extractJson(content)) as unknown
          if (image && result && typeof result === 'object' && 'imageAccessible' in result && result.imageAccessible === false)
            throw new Error('O modelo não recebeu o conteúdo da imagem.')
          return result
        } catch (error) {
          const status = error && typeof error === 'object' && 'auditGatewayStatus' in error ? Number(error.auditGatewayStatus) : null
          if (index === models.length - 1 || controller.signal.aborted || (status !== null && status !== 429 && status < 500)) throw error
        } finally {
          if (timer) clearTimeout(timer)
          attempt.abort()
        }
      }
      throw new Error('Gateway da auditoria devolveu resposta vazia.')
    })(), 90_000)
  } finally {
    controller.abort()
  }
}

/** O áudio passa pelo mesmo gateway e pela chave privada da organização. */
export async function transcribeAuditAudio(organizationId: string, file: Blob, filename: string) {
  const cfg = await getOrgAiConfig(organizationId)
  if (!cfg.baseUrl) throw new Error('Gateway de transcrição não configurado.')
  const env = getServerEnv()
  const controller = new AbortController()
  try {
    return await withTimeout((async () => {
      const form = new FormData()
      form.append('file', file, filename)
      form.append('model', env.OMNIROUTE_AUDIO_MODEL || 'groq/whisper-large-v3')
      form.append('language', 'pt')
      form.append('response_format', 'verbose_json')
      form.append('temperature', '0')
      const response = await fetch(`${cfg.baseUrl!.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST', signal: controller.signal, body: form,
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      })
      if (!response.ok) throw auditGatewayFailure(response, 'audio')
      const result = await response.json() as { text?: unknown; segments?: { avg_logprob?: number; no_speech_prob?: number }[] }
      if (typeof result.text !== 'string') throw new Error('Transcrição sem texto válido.')
      const uncertain = !result.text.trim() || result.segments?.some(segment =>
        (segment.avg_logprob ?? 0) < -1 || (segment.no_speech_prob ?? 0) > 0.6)
      return { text: result.text.trim(), uncertain: !!uncertain }
    })(), 90_000)
  } finally { controller.abort() }
}

// Exportado só pra teste (validação do parsing sem precisar chamar a API de verdade).
export const __testing = { parseResponse, buildPrompt, extractJson, buildQaPrompt }
