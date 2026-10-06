import { z } from 'zod'
import type { AdminClient } from '@/lib/supabase/admin'
import { readAuditObject, type AuditRun, type ConversationAudit } from './full-audit'

// O executor grava este mesmo tamanho antes de publicar o progresso da conversa.
export const REPORT_INDEX_SIZE = 25
export interface AuditReportIndex {
  organizationId: string; runId: string; part: number; records: Record<string, ConversationAudit>
}
export function compactReportRecord(result: ConversationAudit): ConversationAudit {
  return { ...result, previousInsight: null,
    chunks: result.chunks.map(chunk => ({ ...chunk, messageIds: [] })),
    media: result.media.map(media => ({ ...media, interpretation: { ...media.interpretation, text: '' } })) }
}

/** Os índices aceleram a leitura; registros antigos ou ausentes continuam usando o resultado original. */
export async function loadIndexedAuditResults(admin: AdminClient, run: AuditRun) {
  const completed = run.conversations.filter(item => item.state === 'completed')
  const origins = new Map<string, AuditRun>([[run.id, run]])
  for (const id of new Set(completed.map(item => item.resultRunId || run.id))) {
    if (!z.string().uuid().safeParse(id).success) throw new Error('Referência inválida.')
    if (!origins.has(id)) {
      const origin = await readAuditObject<AuditRun>(admin, `${run.organizationId}/runs/${id}/run.json`)
      if (!origin || origin.id !== id || origin.organizationId !== run.organizationId) throw new Error('Origem incompatível.')
      origins.set(id, origin)
    }
  }
  const positions = new Map([...origins].map(([id, origin]) => [id, new Map(origin.conversations.map((item, index) => [item.id, index]))]))
  const parts = new Map<string, { origin: string; part: number }>()
  for (const item of completed) {
    if (!z.string().uuid().safeParse(item.id).success) throw new Error('Referência inválida.')
    const origin = item.resultRunId || run.id, position = positions.get(origin)!.get(item.id)
    if (position === undefined) throw new Error('Conversa fora da origem registrada.')
    const part = Math.floor(position / REPORT_INDEX_SIZE)
    parts.set(`${origin}/${part}`, { origin, part })
  }
  const indexed = new Map<string, AuditReportIndex | null>()
  const groups = [...parts.entries()]
  for (let offset = 0; offset < groups.length; offset += 12) await Promise.all(groups.slice(offset, offset + 12).map(async ([key, { origin, part }]) => {
    const data = await readAuditObject<AuditReportIndex>(admin, `${run.organizationId}/runs/${origin}/report-index/part-${part}.json`)
    if (data && (data.organizationId !== run.organizationId || data.runId !== origin || data.part !== part || !data.records))
      throw new Error('Índice incompatível com a auditoria.')
    indexed.set(key, data)
  }))
  const results: ConversationAudit[] = []
  for (let offset = 0; offset < completed.length; offset += 12) {
    const batch = await Promise.all(completed.slice(offset, offset + 12).map(async item => {
      const origin = item.resultRunId || run.id, part = Math.floor(positions.get(origin)!.get(item.id)! / REPORT_INDEX_SIZE)
      const result = indexed.get(`${origin}/${part}`)?.records[item.id]
        || await readAuditObject<ConversationAudit>(admin, `${run.organizationId}/runs/${origin}/conversations/${item.id}/result.json`)
      if (result && (result.conversationId !== item.id || result.runId !== origin)) throw new Error('Resultado incompatível com a auditoria.')
      return result
    }))
    results.push(...batch.filter((item): item is ConversationAudit => !!item))
  }
  return results
}
