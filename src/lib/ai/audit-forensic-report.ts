import type { AuditRun, ConversationAudit } from './full-audit'
import { FORENSIC_STATUSES, CLOSING_TYPES, forensicCoreOutcome, type ForensicAnalysis } from './audit-forensic'

export interface ForensicLedgerRow {
  conversationId: string; channel: string; customer: string | null; assignedToId: string | null; lastInteraction: string | null
  crmStatus: string | null; auditedStatus: ForensicAnalysis['status'] | null; confidence: ForensicAnalysis['confidence'] | null
  evidenceState: ForensicAnalysis['basis'] | null; analysis: ForensicAnalysis | null
  imageStatus: 'VERIFICADA' | 'EVIDENCIA_VISUAL_NAO_VERIFICADA' | 'NAO_IDENTIFICADA'
  crmDivergence: boolean | null; manualReview: boolean; secondPassAt: string | null; reason: string
}
export function buildForensicLedger(run: AuditRun, results: ConversationAudit[]) {
  const byId = new Map(results.map(result => [result.conversationId, result]))
  const rows: ForensicLedgerRow[] = run.conversations.map(item => {
    const result = item.state === 'completed' ? byId.get(item.id) : undefined
    const forensic = result?.quality?.secondPassAt ? result.forensic : undefined
    const imageIds = forensic?.relevantImageIds || []
    const missingImages = imageIds.some(id => result?.media.find(media => media.messageId === id)?.interpretation.state !== 'interpreted')
    const crmOutcome = result?.recordedOutcome || (result?.recordedStage ? 'aberta' : null)
    const divergence = forensic && crmOutcome ? crmOutcome !== forensicCoreOutcome(forensic.status) : null
    return { conversationId: item.id, channel: item.channel, customer: result?.contactName ?? null, assignedToId: result?.assigneeId ?? null,
      lastInteraction: result?.coverage.to ?? null, crmStatus: result?.recordedOutcome || result?.recordedStage || null,
      auditedStatus: forensic?.status ?? null, confidence: forensic?.confidence ?? null, evidenceState: forensic?.basis ?? null,
      analysis: forensic ?? null, imageStatus: missingImages ? 'EVIDENCIA_VISUAL_NAO_VERIFICADA' : imageIds.length ? 'VERIFICADA' : 'NAO_IDENTIFICADA',
      crmDivergence: divergence, manualReview: !forensic || forensic.status === 'INCONCLUSIVA' || forensic.confidence === 'BAIXA' || missingImages || divergence === true,
      secondPassAt: result?.quality?.secondPassAt ?? null,
      reason: forensic?.reasoning || (item.state === 'failed' ? 'A conversa não foi concluída pelo executor.'
        : result ? 'Resultado anterior disponível; falta revisão forense multimodal com segunda passagem.' : 'Revisão individual ainda não disponível.') }
  })
  const analyzed = rows.filter(row => !!row.auditedStatus)
  const counts = Object.fromEntries(FORENSIC_STATUSES.map(status => [status, analyzed.filter(row => row.auditedStatus === status).length])) as Record<ForensicAnalysis['status'], number>
  const sum = Object.values(counts).reduce((total, value) => total + value, 0)
  const reconciled = sum === analyzed.length
  const effective = analyzed.length
  const complete = effective === rows.length && reconciled
  const metrics = ['GANHA', 'PERDIDA', 'ABANDONADA_SEM_RESPOSTA', 'INCONCLUSIVA'].map(status => ({
    status, numerator: counts[status as ForensicAnalysis['status']], denominator: effective,
    percent: effective ? counts[status as ForensicAnalysis['status']] / effective * 100 : null,
  }))
  const lost = analyzed.filter(row => ['PERDIDA', 'ABANDONADA_SEM_RESPOSTA'].includes(row.auditedStatus!))
  const lossReasons = [...new Set(lost.map(row => row.analysis?.lossReason || 'MOTIVO_NAO_IDENTIFICADO'))].map(reason => {
    const matches = lost.filter(row => (row.analysis?.lossReason || 'MOTIVO_NAO_IDENTIFICADO') === reason)
    return { reason, count: matches.length, denominator: lost.length,
      controllable: matches.filter(row => row.analysis?.controllability === 'CONTROLAVEL').length,
      uncontrollable: matches.filter(row => row.analysis?.controllability === 'NAO_CONTROLAVEL').length,
      indeterminate: matches.filter(row => row.analysis?.controllability === 'INDETERMINADA').length,
      examples: matches.slice(0, 3).map(row => row.conversationId) }
  }).sort((a, b) => b.count - a.count)
  const behaviors = (type: 'errors' | 'strengths') => [...new Set(analyzed.flatMap(row => row.analysis?.[type].map(finding => finding.code) || []))].map(code => {
    const matches = analyzed.filter(row => row.analysis?.[type].some(finding => finding.code === code))
    return { code, conversations: matches.length, confirmed: matches.filter(row => row.analysis?.[type].some(finding => finding.code === code && finding.basis === 'CONFIRMADO')).length,
      inferred: matches.filter(row => row.analysis?.[type].some(finding => finding.code === code && finding.basis === 'INFERIDO')).length,
      possibleAffectedSales: matches.filter(row => ['PERDIDA', 'ABANDONADA_SEM_RESPOSTA'].includes(row.auditedStatus!)).length,
      examples: matches.slice(0, 3).map(row => row.conversationId) }
  }).sort((a, b) => b.conversations - a.conversations)
  const recovery = analyzed.filter(row => !!row.analysis?.recovery && !['GANHA', 'PERDIDA'].includes(row.auditedStatus!))
    .sort((a, b) => ['QUENTE', 'MORNO', 'FRIO'].indexOf(a.analysis!.recovery!.priority) - ['QUENTE', 'MORNO', 'FRIO'].indexOf(b.analysis!.recovery!.priority))
  const stages = ['intent', 'quote', 'negotiation', 'paymentRequested', 'orderClosed'] as const
  const funnel = stages.map(stage => ({ stage, count: analyzed.filter(row => row.analysis?.funnel[stage] === true).length,
    unknown: analyzed.filter(row => row.analysis?.funnel[stage] === null).length, denominator: effective }))
  return { rows, summary: { expected: rows.length, effective, notAnalyzed: rows.length - effective, counts, sum, reconciled, complete, metrics,
    notAnalyzedIds: rows.filter(row => !row.auditedStatus).map(row => ({ conversationId: row.conversationId, reason: row.reason })),
    closingTypes: Object.fromEntries(CLOSING_TYPES.map(type => [type, analyzed.filter(row => row.auditedStatus === 'GANHA' && row.analysis?.closingType === type).length])),
    pixSales: analyzed.filter(row => row.auditedStatus === 'GANHA' && row.analysis?.paymentMethod === 'PIX').length,
    paymentOnDelivery: analyzed.filter(row => row.auditedStatus === 'GANHA' && row.analysis?.paymentOnDelivery).length,
    motoboy: analyzed.filter(row => row.auditedStatus === 'GANHA' && row.analysis?.motoboy).length,
    divergences: analyzed.filter(row => row.crmDivergence).length, unknownCrmStatus: analyzed.filter(row => !row.crmStatus).length,
    manualReview: rows.filter(row => row.manualReview).length, unverifiedRelevantImages: analyzed.filter(row => row.imageStatus === 'EVIDENCIA_VISUAL_NAO_VERIFICADA').length,
    followUp: { confirmed: analyzed.filter(row => row.analysis?.followUp.performed === true).length,
      absent: analyzed.filter(row => row.analysis?.followUp.performed === false).length, unknown: analyzed.filter(row => row.analysis?.followUp.performed === null).length },
    funnel, lossReasons, errors: behaviors('errors'), strengths: behaviors('strengths'), recoverable: recovery.map(row => ({ conversationId: row.conversationId,
      lastInteraction: row.lastInteraction, objection: row.analysis?.mainObjection, ...row.analysis!.recovery! })),
    duplicates: 'Não verificado: não há vínculo suficiente para equiparar conversas e negócios distintos.',
    attribution: 'Responsável atribuído no CRM é uma referência auxiliar; autoria de cada mensagem deve ser conferida.' } }
}
export type ForensicReport = ReturnType<typeof buildForensicLedger>
