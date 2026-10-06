// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuditPanel } from '../AuditPanel'

const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const summary = { audit: { id: runId, cutoff: '2026-10-01T00:00:00Z', status: 'running', total: 905, completed: 100,
  failed: 0, messages: 3000, mediaUntranscribed: 10, mode: 'text', channels: [] },
  auditedConversationIds: [], control: { available: true, online: true, state: 'running' } }
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? Response.json({ request: { state: 'queued' } }, { status: 202 }) : Response.json(summary))
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Ações da auditoria', () => {
  it('atualizar pede revisão das conversas novas vinculada à leitura exibida', async () => {
    render(<AuditPanel rows={[]} onProgress={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Atualizar conversas' }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(posted[1]!.body as string)).toMatchObject({ action: 'update', expectedRunId: runId })
    await waitFor(() => expect(screen.getByText(/Atualização solicitada/)).toBeTruthy())
  })
  it('retomar envia ação própria sem iniciar uma atualização do histórico', async () => {
    render(<AuditPanel rows={[]} onProgress={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Retomar leitura' }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false)); fireEvent.click(button)
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(posted[1]!.body as string)).toMatchObject({ action: 'resume', expectedRunId: runId })
  })
  it('mostra falha de gravação sem apresentar mensagem de sucesso', async () => {
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? Response.json({ error: 'A auditoria mudou. Atualize o progresso e tente novamente.' }, { status: 409 }) : Response.json(summary))
    render(<AuditPanel rows={[]} onProgress={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Atualizar conversas' }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false)); fireEvent.click(button)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('A auditoria mudou'))
    expect(screen.queryByText(/Atualização solicitada/)).toBeNull()
  })
  it('atualizar progresso apenas relê o painel, sem enfileirar análise', async () => {
    render(<AuditPanel rows={[]} onProgress={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/100 de 905/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }))
    await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(1))
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
})
