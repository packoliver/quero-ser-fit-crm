import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: vi.fn(),
  select: vi.fn(),
  selectEq: vi.fn(),
  maybeSingle: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAuthenticatedUserContext: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/security/encryption', () => ({ encryptToken: mocks.encrypt, decryptToken: mocks.decrypt }))

import { GET, POST } from '@/app/api/configuracoes/ia/route'

const postRequest = (body: unknown) => new NextRequest('http://localhost/api/configuracoes/ia', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', 'x-org-id': 'another-org' },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ authenticated: true, userId: 'admin', role: 'admin', organizationId: 'caller-org' })
  mocks.admin.mockReturnValue({ from: () => ({ select: mocks.select, update: mocks.update }) })
  mocks.select.mockReturnValue({ eq: mocks.selectEq })
  mocks.selectEq.mockReturnValue({ maybeSingle: mocks.maybeSingle })
  mocks.maybeSingle.mockResolvedValue({ data: {
    id: 'caller-org', ai_gateway_url: 'https://gateway.example/v1',
    ai_gateway_model: 'model', ai_gateway_api_key_encrypted: 'encrypted-value',
  }, error: null })
  mocks.update.mockReturnValue({ eq: mocks.updateEq })
  mocks.updateEq.mockResolvedValue({ error: null })
  mocks.encrypt.mockReturnValue('encrypted-value')
  mocks.decrypt.mockReturnValue('test-credential-value')
})

describe('AI configuration API authorization and validation', () => {
  it('rejects anonymous reads and writes before creating a privileged client', async () => {
    mocks.auth.mockResolvedValue({ authenticated: false, userId: null })
    expect((await GET())?.status).toBe(401)
    expect((await POST(postRequest({})))?.status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it.each(['attendant', 'manager'])('rejects %s access to gateway credentials', async (role) => {
    mocks.auth.mockResolvedValue({ authenticated: true, userId: 'user', role, organizationId: 'caller-org' })
    expect((await GET())?.status).toBe(403)
    expect((await POST(postRequest({})))?.status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('filters reads by the organization resolved from the session and masks the key', async () => {
    const response = await GET()
    expect(response?.status).toBe(200)
    expect(mocks.selectEq).toHaveBeenCalledWith('id', 'caller-org')
    const body = await response?.json()
    expect(body.ai_gateway_api_key_masked).toBe('tes***lue')
    expect(JSON.stringify(body)).not.toContain('test-credential-value')
    expect(JSON.stringify(body)).not.toContain('encrypted-value')
  })

  it('ignores a supplied organization and encrypts the key before writing to the caller organization', async () => {
    const response = await POST(postRequest({
      org_id: 'another-org', ai_gateway_url: 'https://gateway.example/v1',
      ai_gateway_model: 'model', ai_gateway_api_key: ' test-credential ',
    }))
    expect(response?.status).toBe(200)
    expect(mocks.selectEq).toHaveBeenCalledWith('id', 'caller-org')
    expect(mocks.updateEq).toHaveBeenCalledWith('id', 'caller-org')
    expect(mocks.encrypt).toHaveBeenCalledWith('test-credential')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ ai_gateway_api_key_encrypted: 'encrypted-value' }))
  })

  it.each([undefined, '', '  '])('preserves an existing key when the submitted value is %j', async (key) => {
    expect((await POST(postRequest({ ai_gateway_api_key: key })))?.status).toBe(200)
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('ai_gateway_api_key_encrypted')
  })

  it('removes a key only when explicitly given null', async () => {
    expect((await POST(postRequest({ ai_gateway_api_key: null })))?.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ ai_gateway_api_key_encrypted: null }))
  })

  it.each([
    { ai_gateway_url: 123 },
    { ai_gateway_api_key: {} },
    { ai_gateway_model: [] },
    { ai_gateway_url: 'file:///private-file' },
    { ai_gateway_url: 'invalid' },
    null,
  ])('rejects invalid input %j without using a privileged client', async (body) => {
    expect((await POST(postRequest(body)))?.status).toBe(400)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON with a client error', async () => {
    const request = new NextRequest('http://localhost/api/configuracoes/ia', { method: 'POST', body: '{' })
    expect((await POST(request))?.status).toBe(400)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
