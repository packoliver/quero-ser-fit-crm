/**
 * Rate Limiter em memória para proteção P0 contra abuso e DDoS.
 * 
 * LIMITAÇÕES CONHECIDAS (aceitas para P0):
 * - Estado em memória: não funciona em múltiplas instâncias/serverless cold starts.
 *   Para produção multi-instância, migrar para Redis/Upstash no P1.
 * - Cleanup passivo: entradas expiram ao serem acessadas ou quando o mapa atinge MAX_BUCKETS.
 *   Sem setInterval para evitar vazamento em serverless.
 * 
 * Por que não usar dependência externa agora? O projeto não tem Redis/ioredis/upstash.
 * Adicionar infra externa é tarefa P1. Esta implementação protege imediatamente contra
 * abuso em single-instance/dev/staging com zero dependências novas.
 */

interface Bucket {
  tokens: number
  lastRefill: number
}

export interface RateLimitConfig {
  /** Máximo de requisições na janela */
  limit: number
  /** Janela de tempo em milissegundos */
  windowMs: number
  /** Identificador do bucket (ex: 'ip:1.2.3.4', 'user:uuid', 'org:uuid:endpoint') */
  key: string
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfterMs: number | null
}

const MAX_BUCKETS = 50_000 // Evita memory leak se chaves únicas explodirem
const buckets = new Map<string, Bucket>()

function cleanupIfNeeded(): void {
  if (buckets.size <= MAX_BUCKETS) return
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    // Remove buckets que não são acessados há mais de 1 hora
    if (now - bucket.lastRefill > 3_600_000) {
      buckets.delete(key)
    }
  }
  // Se ainda estiver cheio, remove os mais antigos (FIFO aproximado)
  if (buckets.size > MAX_BUCKETS) {
    const toDelete = buckets.size - MAX_BUCKETS
    let deleted = 0
    for (const key of buckets.keys()) {
      if (deleted >= toDelete) break
      buckets.delete(key)
      deleted++
    }
  }
}

export function checkRateLimit(config: RateLimitConfig): RateLimitResult {
  cleanupIfNeeded()
  
  const now = Date.now()
  let bucket = buckets.get(config.key)
  
  if (!bucket) {
    bucket = { tokens: config.limit, lastRefill: now }
    buckets.set(config.key, bucket)
  }
  
  // Refill tokens baseado no tempo decorrido
  const elapsed = now - bucket.lastRefill
  const refillAmount = Math.floor((elapsed / config.windowMs) * config.limit)
  
  if (refillAmount > 0) {
    bucket.tokens = Math.min(config.limit, bucket.tokens + refillAmount)
    bucket.lastRefill = now
  }
  
  if (bucket.tokens > 0) {
    bucket.tokens--
    return {
      allowed: true,
      remaining: bucket.tokens,
      resetAt: bucket.lastRefill + config.windowMs,
      retryAfterMs: null,
    }
  }
  
  // Calcular quando o próximo token estará disponível
  const timeUntilNextToken = config.windowMs - elapsed
  return {
    allowed: false,
    remaining: 0,
    resetAt: bucket.lastRefill + config.windowMs,
    retryAfterMs: Math.max(0, timeUntilNextToken),
  }
}

/**
 * Extrai identificador do cliente para rate limiting.
 * Prioriza IP real (X-Forwarded-For) → IP direto → fallback 'unknown'.
 * Em produção atrás de proxy confiável, X-Forwarded-For é seguro.
 */
export function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // Pega o primeiro IP da cadeia (cliente real)
    const firstIp = forwarded.split(',')[0]?.trim()
    if (firstIp) return `ip:${firstIp}`
  }
  
  // Fallbacks para ambientes sem proxy
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return `ip:${realIp}`
  
  return 'ip:unknown'
}

// Configurações padrão por tipo de endpoint
export const RATE_LIMITS = {
  // Webhooks: generoso para não bloquear provedores legítimos, mas com teto
  webhook: { limit: 100, windowMs: 60_000 },
  // API autenticada: uso normal de CRM
  api: { limit: 60, windowMs: 60_000 },
  // IA: caro, limitar por org para evitar custo desproporcional
  ai: { limit: 20, windowMs: 60_000 },
  // Auth: prevenir brute force
  auth: { limit: 10, windowMs: 60_000 },
  // Upload: pesado, limitar fortemente
  upload: { limit: 10, windowMs: 60_000 },
  // Público: mais restritivo
  public: { limit: 30, windowMs: 60_000 },
} as const