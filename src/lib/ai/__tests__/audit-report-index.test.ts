import { beforeEach, expect, it, vi } from 'vitest'
import type { AuditRun, ConversationAudit } from '../full-audit'
const read = vi.hoisted(() => vi.fn())
vi.mock('../full-audit', () => ({ readAuditObject: read }))
import { compactReportRecord, loadIndexedAuditResults } from '../audit-report-index'
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`
const run = { id: runId, organizationId: org, conversations: Array.from({ length: 60 }, (_, n) => ({ id: id(n), channel: 'whatsapp', state: 'completed' })) } as AuditRun
const result = (n: number, origin = runId) => ({ conversationId: id(n), runId: origin, chunks: [], media: [] }) as unknown as ConversationAudit
beforeEach(() => { read.mockReset() })
it('lê todas as 60 conversas com três índices sem amostragem', async () => {
  read.mockImplementation(async (_admin, path: string) => {
    const part = Number(path.match(/part-(\d+)/)?.[1])
    return { organizationId: org, runId, part, records: Object.fromEntries(run.conversations.slice(part * 25, part * 25 + 25).map((c, n) => [c.id, result(part * 25 + n)])) }
  })
  expect(await loadIndexedAuditResults({} as never, run)).toHaveLength(60)
  expect(read).toHaveBeenCalledTimes(3)
})
it('índice ausente usa cada resultado original e preserva lacunas', async () => {
  read.mockImplementation(async (_admin, path: string) => path.endsWith(`/conversations/${id(0)}/result.json`) ? result(0) : null)
  expect(await loadIndexedAuditResults({} as never, run)).toHaveLength(1)
  expect(read).toHaveBeenCalledTimes(63)
})
it('carry usa a posição no inventário original, não na revisão atual', async () => {
  const previousId = id(99), previous = { ...run, id: previousId }
  const current = { ...run, conversations: [{ ...run.conversations[59], resultRunId: previousId }] }
  read.mockImplementation(async (_admin, path: string) => path.endsWith('/run.json') ? previous
    : { organizationId: org, runId: previousId, part: 2, records: { [id(59)]: result(59, previousId) } })
  expect(await loadIndexedAuditResults({} as never, current)).toEqual([result(59, previousId)])
  expect(read.mock.calls[1][1]).toContain('part-2.json')
})
it('rejeita índices e resultados de outra organização ou revisão', async () => {
  read.mockResolvedValue({ organizationId: id(99), runId, part: 0, records: {} })
  await expect(loadIndexedAuditResults({} as never, run)).rejects.toThrow('Índice incompatível')
  read.mockImplementation(async (_admin, path: string) => path.includes('/report-index/') ? null : result(0, id(99)))
  await expect(loadIndexedAuditResults({} as never, run)).rejects.toThrow('Resultado incompatível')
})
it('compactação preserva achados e evidências sem duplicar texto de anexos ou insight anterior', () => {
  const full = { ...result(0), previousInsight: { secret: 'old' }, chunks: [{ hash: 'hash', messageIds: [id(1)], analysis: { findings: [{ description: 'fact' }] } }],
    media: [{ messageId: id(1), interpretation: { state: 'interpreted', text: 'long receipt', limitations: [] } }] } as unknown as ConversationAudit
  const compact = compactReportRecord(full)
  expect(compact.previousInsight).toBeNull(); expect(compact.chunks[0].analysis).toEqual(full.chunks[0].analysis)
  expect(compact.media[0].interpretation.text).toBe(''); expect(compact.media[0].interpretation.state).toBe('interpreted')
  expect(full.media[0].interpretation.text).toBe('long receipt')
})
