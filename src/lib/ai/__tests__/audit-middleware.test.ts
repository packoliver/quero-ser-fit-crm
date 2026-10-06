import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ server: vi.fn(), user: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.server }))
import { updateSession } from '@/lib/supabase/middleware'
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: null }, error: null }); mocks.server.mockReturnValue({ auth: { getUser: mocks.user } }) })
describe('Executor da auditoria pelo proxy de sessão', () => {
  it.each(['/api/internal/full-audit', '/api/internal/full-audit/control'])('encaminha %s ao handler que valida o bearer de serviço', async path => {
    const response = await updateSession(new NextRequest(`https://crm.test${path}`))
    expect(response.headers.get('x-middleware-next')).toBe('1'); expect(mocks.server).not.toHaveBeenCalled()
  })
  it.each(['/api/ai/audit', '/api/ai/audit/report', '/api/internal/full-audit/control/other'])('mantém sessão obrigatória para %s', async path => {
    const response = await updateSession(new NextRequest(`https://crm.test${path}`))
    expect(response.status).toBe(401); expect(mocks.user).toHaveBeenCalledOnce()
  })
})
