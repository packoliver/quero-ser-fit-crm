import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthenticatedUserContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getLatestAuditRun, readAuditObject, summarizeAuditRun, type ConversationAudit } from '@/lib/ai/full-audit'
import { auditCommandSchema, getAuditControl, queueAuditCommand } from '@/lib/ai/audit-control'

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!auth.organizationId || !['admin', 'manager'].includes(auth.role || '')) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const requestId = request.nextUrl.searchParams.get('requestId')
  if (requestId && !z.string().uuid().safeParse(requestId).success) return NextResponse.json({ error: 'Solicitação inválida.' }, { status: 400 })
  try {
    const admin = createAdminClient()
    const run = await getLatestAuditRun(admin, auth.organizationId)
    if (!run) return NextResponse.json({ audit: null, control: await getAuditControl(admin, auth.organizationId, requestId) }, { headers: { 'Cache-Control': 'no-store' } })
    const conversationId = request.nextUrl.searchParams.get('conversationId')
    if (conversationId) {
      if (!z.string().uuid().safeParse(conversationId).success) return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 })
      const conversation = run.conversations.find(item => item.id === conversationId)
      if (!conversation) return NextResponse.json({ error: 'Conversa fora desta auditoria.' }, { status: 404 })
      const resultRunId = conversation.resultRunId || run.id
      if (!z.string().uuid().safeParse(resultRunId).success) throw new Error('Referência de auditoria inválida.')
      const detail = await readAuditObject<ConversationAudit>(admin, `${auth.organizationId}/runs/${resultRunId}/conversations/${conversationId}/result.json`)
      return NextResponse.json({ detail: detail ? { conversationId, channel: detail.channel, cutoff: detail.cutoff,
        coverage: detail.coverage, analysis: detail.analysis, insightUpdated: detail.insightUpdated, media: detail.media || [],
        recordedOutcome: detail.recordedOutcome ?? null,
        findings: [...new Map([...detail.chunks.flatMap(chunk => chunk.analysis.findings), ...detail.analysis.findings]
          .map(finding => [JSON.stringify(finding), finding])).values()] } : null }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ audit: summarizeAuditRun(run), control: await getAuditControl(admin, auth.organizationId, requestId),
      auditedConversationIds: run.conversations.filter(item => item.state === 'completed').map(item => item.id) },
      { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar a auditoria.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!auth.organizationId || !['admin', 'manager'].includes(auth.role || '')) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 })
  const parsed = auditCommandSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Solicitação inválida.' }, { status: 400 })
  try {
    const admin = createAdminClient()
    const control = await getAuditControl(admin, auth.organizationId)
    if (!control.available) return NextResponse.json({ error: 'O executor ainda precisa ser atualizado na VPS para receber solicitações pelo painel.' }, { status: 503 })
    return NextResponse.json({ request: await queueAuditCommand(admin, auth.organizationId, parsed.data) },
      { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const changed = error instanceof Error && ['AUDIT_CHANGED', 'AUDIT_MISSING'].includes(error.message)
    return NextResponse.json({ error: changed ? 'A auditoria mudou. Atualize o progresso e tente novamente.' : 'Não foi possível salvar a solicitação. Tente novamente.' }, { status: changed ? 409 : 500 })
  }
}
