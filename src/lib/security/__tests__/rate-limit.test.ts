import { describe, it, expect, beforeEach, vi } from 'vitest'
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '../rate-limit'

describe('Rate Limiter em memória', () => {
  beforeEach(() => {
    // Limpa estado entre testes — cada teste começa com buckets vazios
    // Nota: como o mapa é privado no módulo, usamos chaves únicas por teste
  })

  it('deve permitir requisições dentro do limite', () => {
    const key = `test-allow-${Date.now()}`
    const result = checkRateLimit({ limit: 5, windowMs: 60_000, key })
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
    expect(result.retryAfterMs).toBeNull()
  })

  it('deve bloquear quando o limite é excedido', () => {
    const key = `test-block-${Date.now()}`
    // Esgota todos os tokens
    for (let i = 0; i < 3; i++) {
      checkRateLimit({ limit: 3, windowMs: 60_000, key })
    }
    // Próxima deve ser bloqueada
    const result = checkRateLimit({ limit: 3, windowMs: 60_000, key })
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('deve recarregar tokens após passagem do tempo', async () => {
    const key = `test-refill-${Date.now()}`
    // Esgota tokens
    for (let i = 0; i < 2; i++) {
      checkRateLimit({ limit: 2, windowMs: 100, key })
    }
    // Espera a janela passar
    await new Promise((r) => setTimeout(r, 150))
    // Deve ter recarregado
    const result = checkRateLimit({ limit: 2, windowMs: 100, key })
    expect(result.allowed).toBe(true)
  })

  it('buckets diferentes são independentes', () => {
    const key1 = `test-indep-a-${Date.now()}`
    const key2 = `test-indep-b-${Date.now()}`
    // Esgota key1
    for (let i = 0; i < 2; i++) {
      checkRateLimit({ limit: 2, windowMs: 60_000, key: key1 })
    }
    const blocked = checkRateLimit({ limit: 2, windowMs: 60_000, key: key1 })
    expect(blocked.allowed).toBe(false)
    // key2 deve estar intacta
    const allowed = checkRateLimit({ limit: 2, windowMs: 60_000, key: key2 })
    expect(allowed.allowed).toBe(true)
  })

  it('RATE_LIMITS deve ter configurações coerentes', () => {
    expect(RATE_LIMITS.webhook.limit).toBeGreaterThan(RATE_LIMITS.auth.limit)
    expect(RATE_LIMITS.ai.limit).toBeLessThanOrEqual(RATE_LIMITS.api.limit)
    expect(RATE_LIMITS.upload.limit).toBeLessThanOrEqual(RATE_LIMITS.api.limit)
  })
})

describe('getClientIdentifier', () => {
  it('deve extrair IP do X-Forwarded-For', () => {
    const req = new Request('http://example.com', {
      headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18, 150.172.238.178' },
    })
    expect(getClientIdentifier(req)).toBe('ip:203.0.113.50')
  })

  it('deve usar X-Real-IP como fallback', () => {
    const req = new Request('http://example.com', {
      headers: { 'x-real-ip': '198.51.100.1' },
    })
    expect(getClientIdentifier(req)).toBe('ip:198.51.100.1')
  })

  it('deve retornar ip:unknown sem headers', () => {
    const req = new Request('http://example.com')
    expect(getClientIdentifier(req)).toBe('ip:unknown')
  })
})