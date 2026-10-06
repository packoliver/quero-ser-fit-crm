'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import type { AuditAnalysis, MediaInterpretation } from '@/lib/ai/audit-model'
import { PAYMENT_LABELS } from '@/lib/ai/insight-view'
import { Button } from '@/components/ui/Button'
import { AuditReportPanel } from './AuditReportPanel'

interface AuditSummary {
  id: string; cutoff: string; status: string; total: number; completed: number; failed: number
  messages: number; mediaInterpreted: number; mediaLimited: number; mediaUntranscribed: number
  channels: { channel: string; total: number; completed: number; messages: number }[]
  mode?: 'text' | 'media'; paymentCounts?: Partial<Record<keyof typeof PAYMENT_LABELS, number>>
  reused?: number
  version?: string
}
interface AuditControl {
  available: boolean; online: boolean; state: string
  waitingReason?: string | null; nextRetryAt?: string | null
  receipt?: { state: string; action: string; message?: string } | null
}
interface AuditDetail {
  conversationId: string; cutoff: string; insightUpdated: boolean; analysis: AuditAnalysis
  recordedOutcome?: AuditAnalysis['outcome'] | null
  findings: AuditAnalysis['findings']
  media: { messageId: string; createdAt: string; interpretation: MediaInterpretation }[]
  coverage: { messages: number; audioTranscribed: number; imagesInterpreted: number; mediaUntranscribed: number }
}
export function AuditPanel({ rows, onProgress }: {
  rows: { conversationId: string; contactName: string }[]; onProgress: () => void
}) {
  const [audit, setAudit] = useState<AuditSummary | null>(null)
  const [ids, setIds] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<AuditDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [control, setControl] = useState<AuditControl | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    let lastCount = -1
    let lastRunId = ''
    let pending = false
    const poll = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch(`/api/ai/audit${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
        if (!response.ok) throw new Error('Não foi possível consultar o progresso da auditoria.')
        const data = await response.json() as { audit: AuditSummary | null; control?: AuditControl; auditedConversationIds?: string[] }
        if (!active) return
        if (data.audit?.id !== lastRunId) {
          lastRunId = data.audit?.id || ''; lastCount = -1; setSelected(''); setDetail(null); setLoading(false)
        }
        setAudit(data.audit); setIds(data.auditedConversationIds || []); setError(null)
        setControl(data.control || null)
        if (data.control?.receipt) {
          const receipt = data.control.receipt
          setNotice(receipt.state === 'completed' ? receipt.action === 'forensic' ? 'Auditoria forense iniciada. O histórico e as mídias serão revisados novamente.' : receipt.action === 'update' ? 'Atualização iniciada. As conversas novas ou alteradas serão revisadas.' : 'Retomada solicitada. O progresso salvo foi preservado.'
            : receipt.state === 'ignored' ? receipt.message || 'Uma revisão mais recente já está em andamento.'
            : receipt.state === 'failed' ? 'A solicitação não foi concluída. Tente retomar a leitura.' : 'Solicitação recebida pelo servidor. Aguarde a etapa em andamento terminar.')
        }
        if (data.audit && lastCount !== data.audit.completed) { lastCount = data.audit.completed; onProgress() }
      } catch { if (active) setError('Progresso da auditoria indisponível. Tente atualizar a página.') }
      finally { pending = false }
    }
    void poll()
    const timer = setInterval(() => void poll(), 30_000)
    return () => { active = false; clearInterval(timer) }
  }, [onProgress, requestId, refresh])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    const load = async () => {
      setLoading(true); setDetail(null)
      try {
        const response = await fetch(`/api/ai/audit?conversationId=${encodeURIComponent(selected)}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Evidências indisponíveis.')
        const data = await response.json() as { detail: AuditDetail | null }
        if (!controller.signal.aborted) { setDetail(data.detail); setError(null) }
      } catch { if (!controller.signal.aborted) setError('Não foi possível carregar as evidências.') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [selected, audit?.id])
  const sendCommand = async (action: 'update' | 'resume' | 'forensic') => {
    if (submitting) return
    setSubmitting(true); setActionError(null)
    const id = crypto.randomUUID()
    try {
      const response = await fetch('/api/ai/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, expectedRunId: audit?.id || null }), signal: AbortSignal.timeout(25_000) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || 'Não foi possível solicitar a atualização.')
      setRequestId(id)
      setNotice(action === 'forensic' ? 'Auditoria forense solicitada. O servidor revisará todo o histórico e as mídias, com cinco desfechos e uma segunda passagem.'
        : action === 'update' ? 'Atualização solicitada. O servidor incluirá as conversas novas e as mensagens que chegaram depois do corte.' : 'Retomada solicitada. O servidor continuará das etapas salvas.')
      setRefresh(value => value + 1)
    } catch (error) { setActionError(error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Não foi possível confirmar a solicitação. Atualize o progresso antes de tentar novamente.') }
    finally { setSubmitting(false) }
  }
  const names = new Map(rows.map(row => [row.conversationId, row.contactName]))
  return <Card>
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Auditoria de todo o histórico</h2>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={submitting || !control?.available} onClick={() => void sendCommand('update')}>Atualizar conversas</Button>
        <Button size="sm" variant="secondary" disabled={submitting || !control?.available || !audit} onClick={() => void sendCommand('resume')}>Retomar leitura</Button>
        <Button size="sm" variant="ghost" onClick={() => setRefresh(value => value + 1)}>Atualizar progresso</Button>
        <Button size="sm" variant="secondary" disabled={submitting || !control?.available} onClick={() => void sendCommand('forensic')}>Auditoria forense completa</Button>
      </div>
    </div></CardHeader>
    <CardBody className="space-y-3 text-xs text-slate-400">
      {error && <p className="text-amber-300" role="alert">{error}</p>}
      {actionError && <p className="text-amber-300" role="alert">{actionError}</p>}
      {notice && <p className="text-emerald-300" role="status">{notice}</p>}
      <p>Atualizar conversas inclui mensagens novas e aproveita as revisões sem mudanças. Retomar leitura continua as pendências sem zerar o progresso.</p>
      {control && !control.available && <p className="text-amber-300">O executor precisa ser atualizado na VPS para habilitar os botões de leitura.</p>}
      {control?.available && !control.online && <p className="text-amber-300">O servidor está sem sinal recente. A solicitação fica salva e será executada quando ele voltar.</p>}
      {control?.state === 'waiting_retry' && <p className="text-amber-300">{control.waitingReason === 'rate_limit'
        ? `O provedor de IA atingiu um limite temporário. O servidor tentará novamente${control.nextRetryAt ? ` após ${new Date(control.nextRetryAt).toLocaleString('pt-BR')}` : ' automaticamente'}. As etapas salvas e as conversas pendentes foram preservadas.`
        : 'Uma etapa aguarda nova tentativa automática. Retomar leitura preserva as etapas já salvas.'}</p>}
      {audit && <>
        <p role="status">{audit.status === 'running' ? 'Em andamento' : audit.status === 'superseded' ? 'Substituída por uma nova revisão' : audit.failed || (audit.mode !== 'text' && audit.mediaUntranscribed) ? 'Finalizada com lacunas para conferência' : 'Revisão automática finalizada'}: {audit.completed} de {audit.total} conversas revisadas · {audit.messages.toLocaleString('pt-BR')} mensagens.</p>
        <progress className="w-full h-2 accent-emerald-500" value={audit.completed} max={Math.max(audit.total, 1)} aria-label="Conversas revisadas" />
        {!!audit.reused && <p>{audit.reused} conversas sem mudanças foram aproveitadas da revisão anterior.</p>}
        <p>{audit.channels.map(channel => `${channel.channel === 'whatsapp' ? 'WhatsApp' : 'Instagram'}: ${channel.completed}/${channel.total}`).join(' · ')}. Corte: {new Date(audit.cutoff).toLocaleString('pt-BR')}.</p>
        {audit.mode === 'text' ? <>
          <p>{audit.mediaUntranscribed || 0} anexos presentes nas conversas revisadas, sem leitura nesta revisão · {audit.failed} conversas com falha.</p>
          <p className="text-[11px]">Revisa todo o contexto textual, com foco no final: venda concluída, pendências e pagamentos, especialmente Pix. Uma chave enviada ou relato do cliente não confirma recebimento. Anexos e movimentações bancárias não foram conferidos. Os cards se atualizam conforme cada conversa termina.</p>
        </> : <>
          <p>{audit.mediaInterpreted || 0} mídias interpretadas sem ressalvas · {audit.mediaLimited || 0} com interpretação limitada · {audit.mediaUntranscribed || 0} mídias exigem conferência · {audit.failed} conversas com falha.</p>
          <p className="text-[11px]">Inclui os textos, áudios e imagens armazenados até o corte. Transcrições e descrições são automáticas; arquivos indisponíveis, vídeos e documentos ficam sinalizados. Os cards são atualizados conforme cada conversa termina.</p>
        </>}
        {audit.mode === 'text' && audit.completed > 0 && <div className="rounded-lg border border-slate-800 p-3 space-y-1">
          <p className="text-slate-200 font-semibold">Pagamentos nas conversas já revisadas</p>
          {(Object.keys(PAYMENT_LABELS) as (keyof typeof PAYMENT_LABELS)[]).map(status => <p key={status}>{PAYMENT_LABELS[status]}: {audit.paymentCounts?.[status] || 0}</p>)}
        </div>}
        {ids.length > 0 && <Select aria-label="Conversa auditada" value={selected} onChange={event => setSelected(event.target.value)} options={[
          { value: '', label: 'Escolha uma conversa para conferir as evidências' },
          ...ids.map(id => ({ value: id, label: `${names.get(id) || 'Conversa'} · ${id.slice(0, 8)}` })),
        ]} />}
      </>}
      {audit && <AuditReportPanel key={audit.id} runId={audit.id} completed={audit.completed} onSelect={setSelected} />}
      {loading && <p role="status">Carregando evidências…</p>}
      {detail && <div className="space-y-3 border-t border-slate-800 pt-3">
        <p className="text-slate-200">{detail.analysis.summary}</p>
        <p className="text-slate-200">Venda: {detail.analysis.outcome === 'ganha' ? 'Concluída' : detail.analysis.outcome === 'perdida' ? 'Perdida' : 'Em aberto'}{detail.analysis.outcomeReason ? ` · ${detail.analysis.outcomeReason}` : ''}</p>
        {!!detail.analysis.outcomeEvidence?.length && <div className="space-y-2">
          <p className="text-slate-200">Evidências do desfecho</p>
          {detail.analysis.outcomeEvidence.map((evidence, index) => <div key={index}>
            <blockquote className="border-l-2 border-emerald-800 pl-2 whitespace-pre-wrap">{evidence.quote}</blockquote>
            <p className="text-[10px] break-all">Mensagem: {evidence.messageId}</p>
          </div>)}
        </div>}
        {detail.recordedOutcome && detail.recordedOutcome !== detail.analysis.outcome && <p className="text-amber-300">O funil registra venda {detail.recordedOutcome === 'ganha' ? 'ganha' : 'perdida'}, mas a revisão do texto indica outro estado. Confira a conversa e o registro manual; o funil foi preservado.</p>}
        {detail.analysis.payment && <div className="rounded-lg border border-slate-800 p-3 space-y-2">
          <p className="text-slate-200">{PAYMENT_LABELS[detail.analysis.payment.status]} · {detail.analysis.payment.method === 'pix' ? 'Pix' : detail.analysis.payment.method === 'outro' ? 'Outra forma de pagamento' : 'Forma não identificada'}</p>
          <p>{detail.analysis.payment.summary}</p>
          {detail.analysis.payment.evidence.map((evidence, index) => <div key={index}>
            <blockquote className="border-l-2 border-emerald-800 pl-2 whitespace-pre-wrap">{evidence.quote}</blockquote>
            <p className="text-[10px] break-all">Mensagem: {evidence.messageId}</p>
          </div>)}
          <p className="text-[11px]">Classificação pelo conteúdo da conversa; não substitui conferência do banco ou do comprovante.</p>
        </div>}
        <p>{detail.coverage.messages} mensagens · {detail.coverage.audioTranscribed} áudios transcritos · {detail.coverage.imagesInterpreted} imagens descritas.</p>
        {!detail.insightUpdated && <p className="text-amber-300">Chegaram mensagens depois do corte. Esta revisão histórica foi preservada separadamente.</p>}
        {detail.findings.map((finding, index) => <div key={index} className="rounded-lg border border-slate-800 p-3 space-y-2">
          <p className="text-slate-200">{finding.type === 'acerto' ? 'Acerto' : finding.type === 'erro' ? 'Erro observado' : 'Pendência'} · confiança {finding.confidence}: {finding.description}</p>
          {finding.evidence.map((evidence, evidenceIndex) => <div key={evidenceIndex}>
            <p className="text-[11px]">{evidence.source === 'audio_transcript' ? 'Transcrição automática do áudio' : evidence.source === 'image_description' ? 'Descrição automática da imagem' : 'Texto original'}:</p>
            <blockquote className="border-l-2 border-emerald-800 pl-2 whitespace-pre-wrap">{evidence.quote}</blockquote>
            <p className="text-[10px] break-all">Mensagem: {evidence.messageId}</p>
          </div>)}
        </div>)}
        {!detail.findings.length && <p>Sem achados com evidência confirmável nesta revisão.</p>}
        {detail.media.length > 0 && <details className="space-y-2">
          <summary className="cursor-pointer text-slate-200">Conferir transcrições, descrições e lacunas ({detail.media.length} arquivos)</summary>
          {detail.media.map(item => <details key={item.messageId} className="p-2 border border-slate-800 rounded-lg">
            <summary className="cursor-pointer">{item.interpretation.kind === 'audio_transcript' ? 'Áudio' : item.interpretation.kind === 'image_description' ? 'Imagem' : 'Anexo sem leitura'} · {new Date(item.createdAt).toLocaleString('pt-BR')} · {item.messageId.slice(0, 8)}</summary>
            <p className="whitespace-pre-wrap mt-2">{item.interpretation.text}</p>
            {item.interpretation.limitations.map((limitation, index) => <p key={index} className="text-amber-300 mt-1">{limitation}</p>)}
            <p className="text-[10px] break-all">Mensagem original: {item.messageId}</p>
          </details>)}
        </details>}
        <Link className="text-emerald-400 underline" href={`/inbox?conversa=${detail.conversationId}`}>Abrir conversa e conferir os originais</Link>
      </div>}
    </CardBody>
  </Card>
}
