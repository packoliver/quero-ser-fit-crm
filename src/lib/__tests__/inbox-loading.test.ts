import { afterEach, describe, expect, it, vi } from 'vitest'
import { inboxLoadErrorMessage, requireInboxResult, withInboxTimeout } from '@/lib/inbox/loading'

afterEach(() => vi.useRealTimers())

describe('Inbox loading failures', () => {
  it('propagates a returned RPC error instead of accepting null data as an empty inbox', async () => {
    const error = { code: '54001', message: 'stack depth limit exceeded' }
    const rpc = Promise.resolve({ data: null, error }).then(requireInboxResult)
    await expect(withInboxTimeout(rpc)).rejects.toBe(error)
    expect(inboxLoadErrorMessage(error)).toContain('regras de acesso')
  })

  it('stops waiting when auth or a supplementary query never settles', async () => {
    vi.useFakeTimers()
    const stuck = new Promise<never>(() => {})
    const result = withInboxTimeout(Promise.all([Promise.resolve({ data: [] }), stuck]))
    const assertion = expect(result).rejects.toThrow('INBOX_TIMEOUT')
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up the timeout after successful loading', async () => {
    vi.useFakeTimers()
    const rows = [{ id: 'conversation' }]
    const result = { data: rows, error: null }
    await expect(withInboxTimeout(Promise.resolve(result).then(requireInboxResult))).resolves.toBe(result)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves rejected requests and removes their timeout', async () => {
    vi.useFakeTimers()
    const error = new Error('Network unavailable')
    await expect(withInboxTimeout(Promise.reject(error))).rejects.toBe(error)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('distinguishes an empty inbox from an error', () => {
    expect(requireInboxResult({ data: [], error: null }).data).toEqual([])
  })

  it.each(['42501', 'PGRST202', '57014', '42P17'])('explains error %s without exposing database internals', (code) => {
    const message = inboxLoadErrorMessage({ code, message: 'internal SQL and sensitive details' })
    expect(message).not.toContain('internal SQL')
    expect(message).not.toBe(inboxLoadErrorMessage(null))
  })

  it('explains an expired session', () => {
    expect(inboxLoadErrorMessage(new Error('INBOX_SESSION_REQUIRED'))).toContain('Entre novamente')
  })
})
