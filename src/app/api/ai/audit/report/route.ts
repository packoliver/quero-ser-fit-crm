import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUserContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { readAuditObject, writeAuditObject } from '@/lib/ai/full-audit'
import { answerAuditReport, auditReportPath, loadAuditReport, reportQuestionSchema, type AuditReport } from '@/lib/ai/audit-report'
import { withRateLimit } from '@/lib/security/rate-limit-middleware'
import { ZodError } from 'zod'

export const maxDuration = 150
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!auth.organizationId || !['admin', 'manager'].includes(auth.role || '')) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  try {
    const report = await loadAuditReport(createAdminClient(), auth.organizationId)
    if (!report) return NextResponse.json({ error: 'Ainda não há auditoria disponível.' }, { status: 404, headers })
    const { sources: _sources, ...presentation } = report
    void _sources
    return NextResponse.json({ report: presentation }, { headers })
  } catch {
    return NextResponse.json({ error: 'Não foi possível preparar o relatório. O progresso da leitura foi preservado.' }, { status: 502, headers })
  }
}

export const POST = withRateLimit('ai', async (request: NextRequest) => {
  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!auth.organizationId || !['admin', 'manager'].includes(auth.role || '')) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 })
  const parsed = reportQuestionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Pergunta ou relatório inválido.' }, { status: 400 })
  try {
    const admin = createAdminClient()
    const { runId, reportId, question } = parsed.data
    const path = auditReportPath(auth.organizationId, runId, reportId)
    const report = await readAuditObject<AuditReport>(admin, path)
    if (!report || report.runId !== runId || report.id !== reportId) return NextResponse.json({ error: 'Atualize o relatório antes de perguntar.' }, { status: 409, headers })
    const response = await answerAuditReport(report, auth.organizationId, question)
    await writeAuditObject(admin, `${auth.organizationId}/runs/${runId}/questions/${randomUUID()}.json`, {
      reportId, question, ...response, createdAt: new Date().toISOString(),
    })
    return NextResponse.json({ ...response, reportId, reviewed: report.reviewed, total: report.total }, { headers })
  } catch (error) {
    console.warn('[audit-report] Pergunta não concluída', { type: error instanceof Error ? error.name : 'unknown',
      validation: error instanceof ZodError ? error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })) : undefined,
      category: error instanceof Error && /referência/.test(error.message) ? 'reference' : undefined,
      http: error instanceof Error ? error.message.match(/HTTP (\d{3})/)?.[1] : undefined })
    return NextResponse.json({ error: 'A IA não concluiu uma resposta com referências válidas. Tente novamente; o relatório e a auditoria continuam salvos.' }, { status: 502, headers })
  }
})
