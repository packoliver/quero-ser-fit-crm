import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIdentifier, RATE_LIMITS, type RateLimitConfig } from './rate-limit'

/**
 * Middleware factory para aplicar rate limiting em rotas Next.js App Router.
 * Retorna um handler wrapper que verifica o limite antes de executar o handler real.
 *
 * Uso em route.ts:
 *   import { withRateLimit } from '@/lib/security/rate-limit-middleware'
 *   export const POST = withRateLimit('ai', async (request) => { ... })
 *
 * Ou com chave customizada por org/usuário:
 *   export const POST = withRateLimit('ai', handler, { keyPrefix: 'org:123' })
 */
export function withRateLimit(
  category: keyof typeof RATE_LIMITS,
  handler: (request: NextRequest, context?: unknown) => Promise<NextResponse>,
  options?: { keyPrefix?: string; getKey?: (request: NextRequest) => string }
) {
  return async (request: NextRequest, context?: unknown): Promise<NextResponse> => {
    let key: string
    if (options?.getKey) {
      key = options.getKey(request)
    } else if (options?.keyPrefix) {
      key = `${options.keyPrefix}:${getClientIdentifier(request)}`
    } else {
      key = `${category}:${getClientIdentifier(request)}`
    }

    const config: RateLimitConfig = {
      limit: RATE_LIMITS[category].limit,
      windowMs: RATE_LIMITS[category].windowMs,
      key,
    }

    const result = checkRateLimit(config)

    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil((result.retryAfterMs ?? 0) / 1000)
      return NextResponse.json(
        {
          error: 'Limite de requisições excedido. Tente novamente mais tarde.',
          retryAfter: retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSeconds),
            'X-RateLimit-Limit': String(config.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
          },
        }
      )
    }

    const response = await handler(request, context)

    // Adiciona headers de rate limit na resposta bem-sucedida também
    response.headers.set('X-RateLimit-Limit', String(config.limit))
    response.headers.set('X-RateLimit-Remaining', String(result.remaining))
    response.headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)))

    return response
  }
}