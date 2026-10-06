import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAuditExecutorAuthorized } from '@/lib/ai/audit-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuditPendingError, auditFullConversation, readAuditObject, type AuditRun } from '@/lib/ai/full-audit'
import { compactReportRecord } from '@/lib/ai/audit-report-index'

export const maxDuration = 150
const schema = z.object({ organizationId: z.string().uuid(), runId: z.string().uuid(), conversationId: z.string().uuid() })

/** Executor administrativo: reutiliza a credencial de serviço já existente; nunca é chamado pelo browser. */
export async function POST(request: Request) {
  if (!isAuditExecutorAuthorized(request)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 })
  const { organizationId, runId, conversationId } = parsed.data
  try {
    const admin = createAdminClient()
    const run = await readAuditObject<AuditRun>(admin, `${organizationId}/runs/${runId}/run.json`)
    const conversation = run?.conversations.find(item => item.id === conversationId)
    if (!run || run.organizationId !== organizationId || run.id !== runId || !conversation) {
      return NextResponse.json({ error: 'Conversa fora da auditoria solicitada.' }, { status: 404 })
    }
    const result = await auditFullConversation(admin, run, conversation, 1)
    return NextResponse.json({ done: true, coverage: result.coverage, insightUpdated: result.insightUpdated,
      outcome: result.analysis.outcome, payment: result.analysis.payment?.status || 'sem_indicio', reportRecord: compactReportRecord(result) })
  } catch (error) {
    if (error instanceof AuditPendingError) return NextResponse.json({ done: false }, { status: 202 })
    const gateway = error as { auditGatewayStatus?: number; retryAfterSeconds?: number; auditGatewayKind?: string }
    if (gateway.auditGatewayStatus === 429) {
      const retryAfter = Math.min(86400, Math.max(1, gateway.retryAfterSeconds || 300))
      console.warn('[full-audit] Limite do provedor', { runId, conversationId, kind: gateway.auditGatewayKind, retryAfter })
      return NextResponse.json({ error: 'O provedor de IA atingiu um limite temporário. A etapa permanece pendente.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } })
    }
    const message = error instanceof Error ? error.message : ''
    const validators = ['Auditoria contém evidência que não corresponde à mensagem original.', 'Confirmação da loja exige evidência do atendente no texto.',
      'Comprovante declarado sem inspeção visual verificável.', 'Pix comprovado sem imagem verificada.',
      'Fechamento por emoji exige comprovante inspecionado e resposta positiva do atendente.', 'Imagem relevante não pertence à conversa.',
      'Estado de pagamento sem evidência verificável.', 'Valor sem evidência.', 'Desfecho sem evidência.',
      'Venda sem tipo de fechamento.', 'Tipo de fechamento em conversa não ganha.']
    console.error('[full-audit] Falha em etapa', { runId, conversationId, type: error instanceof Error ? error.name : 'unknown',
      http: message.match(/HTTP (\d{3})/)?.[1], validator: validators.includes(message) ? message : undefined,
      category: /registro privado/.test(message) ? 'storage' : /timeout|tempo|demorou/i.test(message) ? 'timeout' : undefined,
      validation: error instanceof z.ZodError ? error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })) : undefined })
    return NextResponse.json({ error: 'A etapa não foi concluída; os lotes anteriores continuam salvos.' }, { status: 502 })
  }
}
