import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dns/promises antes de importar o módulo
vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'dns/promises'
const mockLookup = vi.mocked(lookup)

// Importa após o mock estar configurado
// A função validateUrlForFetch não é exportada, então testamos via mirrorMediaToStorage
// que a chama internamente. Se a URL for rejeitada, retorna null sem fazer fetch.
// Para testar a validação isoladamente, precisamos acessar o módulo interno.
// Alternativa: testar o comportamento observável de mirrorMediaToStorage.

describe('Proteção SSRF em mirrorMediaToStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Como validateUrlForFetch é privada, testamos os cenários via comportamento:
  // URLs rejeitadas retornam null sem chamar fetch.
  // URLs aceitas tentam fetch (que falhará em teste, mas prova que passou na validação).

  it('deve rejeitar URL com protocolo file://', async () => {
    // Import dinâmico para garantir que o mock está ativo
    const { mirrorMediaToStorage } = await import('../media')
    const result = await mirrorMediaToStorage({
      sourceUrl: 'file:///etc/passwd',
      organizationId: 'test-org',
    })
    expect(result).toBeNull()
    // fetch não deve ter sido chamado — a URL foi rejeitada antes
  })

  it('deve rejeitar URL com IP loopback 127.0.0.1', async () => {
    const { mirrorMediaToStorage } = await import('../media')
    const result = await mirrorMediaToStorage({
      sourceUrl: 'http://127.0.0.1/admin',
      organizationId: 'test-org',
    })
    expect(result).toBeNull()
  })

  it('deve rejeitar URL com IP privado 10.x.x.x', async () => {
    const { mirrorMediaToStorage } = await import('../media')
    const result = await mirrorMediaToStorage({
      sourceUrl: 'http://10.0.0.1/internal',
      organizationId: 'test-org',
    })
    expect(result).toBeNull()
  })

  it('deve rejeitar URL com IP privado 192.168.x.x', async () => {
    const { mirrorMediaToStorage } = await import('../media')
    const result = await mirrorMediaToStorage({
      sourceUrl: 'http://192.168.1.1/admin',
      organizationId: 'test-org',
    })
    expect(result).toBeNull()
  })

  it('deve rejeitar URL com IP privado 172.16-31.x.x', async () => {
    const { mirrorMediaToStorage } = await import('../media')
    const result = await mirrorMediaToStorage({
      sourceUrl: 'http://172.16.0.1/internal',
      organizationId: 'test-org',
    })
    expect(result).toBeNull()
  })

  it('deve rejeitar URL com IPv6 loopback ::1', async () => {
    const { mirrorMediaToStorage } = await import('../media')
    const result = await mirrorMediaToStorage({
      sourceUrl: 'http://[::1]/admin',
      organizationId: 'test-org',
    })
    expect(result).toBeNull()
  })

  it('deve rejeitar URL que resolve DNS para IP privado', async () => {
    mockLookup.mockResolvedValue([{ address: '192.168.1.100', family: 4 }] as never)
    const { mirrorMediaToStorage } = await import('../media')
    const result = await mirrorMediaToStorage({
      sourceUrl: 'http://evil.example.com/steal',
      organizationId: 'test-org',
    })
    expect(result).toBeNull()
    expect(mockLookup).toHaveBeenCalled()
  })

  it('deve rejeitar URL inválida', async () => {
    const { mirrorMediaToStorage } = await import('../media')
    const result = await mirrorMediaToStorage({
      sourceUrl: 'not-a-valid-url',
      organizationId: 'test-org',
    })
    expect(result).toBeNull()
  })

  it('deve rejeitar URL com link-local 169.254.x.x (metadata endpoints)', async () => {
    const { mirrorMediaToStorage } = await import('../media')
    const result = await mirrorMediaToStorage({
      sourceUrl: 'http://169.254.169.254/latest/meta-data/',
      organizationId: 'test-org',
    })
    expect(result).toBeNull()
  })
})