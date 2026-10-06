// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuditReportPanel } from '../AuditReportPanel'
import { buildForensicLedger } from '@/lib/ai/audit-forensic-report'
import type { AuditRun } from '@/lib/ai/full-audit'

const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reportId = 'a'.repeat(64)
const report = { id: reportId, runId, cutoff: '2026-10-01', generatedAt: '2026-10-06', runUpdatedAt: '', total: 905, reviewed: 100, pending: 805,
  failed: 0, missingResults: 0, messages: 2500, unreadMedia: 12, outcomes: { ganha: 10, aberta: 90, perdida: 0 }, topics: [], emojiSignals: [],
  payments: {}, channels: [], forensic: buildForensicLedger({ conversations: [] } as unknown as AuditRun, []) }
const fetcher = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); fetcher.mockResolvedValue(Response.json({ report })) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Perguntas e relatório dentro da auditoria', () => {
  it('gera relatório por GET, identifica parcial e não inicia outro executor', async () => {
    render(<AuditReportPanel runId={runId} completed={100} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }))
    await waitFor(() => expect(screen.getByText(/Relatório parcial: 100\/905/)).toBeTruthy())
    expect(fetcher.mock.calls[0][1].method).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Baixar tabela individual' })).toBeTruthy()
  })
  it('pergunta se vincula ao snapshot e só mostra uma resposta confirmada pelo servidor', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ report })).mockResolvedValueOnce(Response.json({ answer: 'Há uma melhoria a conferir.', sources: [] }))
    render(<AuditReportPanel runId={runId} completed={100} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }))
    await waitFor(() => expect(screen.getByLabelText('Pergunte sobre esta auditoria')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Pergunte sobre esta auditoria'), { target: { value: 'O que faltou no fechamento?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar à IA da auditoria' }))
    await waitFor(() => expect(screen.getByText('Há uma melhoria a conferir.')).toBeTruthy())
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ runId, reportId, question: 'O que faltou no fechamento?' })
  })
  it('erros e troca de auditoria não exibem sucesso nem resposta antiga', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ error: 'Gateway indisponível.' }, { status: 502 }))
    render(<AuditReportPanel runId={runId} completed={100} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Gateway indisponível'))
    expect(screen.queryByLabelText('Pergunte sobre esta auditoria')).toBeNull()
  })
  it('snapshot de outra revisão é recusado e requisição pendente é cancelada ao sair', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ report: { ...report, runId: 'another-run' } }))
    const rendered = render(<AuditReportPanel runId={runId} completed={100} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('A auditoria mudou'))
    fetcher.mockImplementationOnce(() => new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }))
    const signal = fetcher.mock.calls[1][1].signal
    rendered.unmount(); expect(signal.aborted).toBe(true)
  })
})
