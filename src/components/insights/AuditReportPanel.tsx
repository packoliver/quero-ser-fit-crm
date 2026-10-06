'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import type { AuditReportAnswer, ReportExample } from '@/lib/ai/audit-report'
import { exportAuditReport, type AuditReportPresentation } from '@/lib/ai/audit-report-export'
import { ForensicReportTable } from './ForensicReportTable'

export function AuditReportPanel({ runId, completed, onSelect }: { runId: string; completed: number; onSelect: (id: string) => void }) {
  const [report, setReport] = useState<AuditReportPresentation | null>(null)
  const [question, setQuestion] = useState('')
  const [answeredQuestion, setAnsweredQuestion] = useState('')
  const [answer, setAnswer] = useState<AuditReportAnswer | null>(null)
  const [busy, setBusy] = useState<'report' | 'question' | null>(null)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { const controller = request.current; request.current = null; controller?.abort() }, [])
  const execute = async (kind: 'report' | 'question') => {
    if (busy || (kind === 'question' && !report)) return
    const controller = new AbortController(); request.current = controller
    setBusy(kind); setError('')
    const timer = setTimeout(() => controller.abort(), kind === 'report' ? 145_000 : 120_000)
    try {
      const response = await fetch('/api/ai/audit/report', { cache: 'no-store', signal: controller.signal,
        ...(kind === 'question' ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: report!.runId, reportId: report!.id, question: question.trim() }) } : {}) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.')
      if (kind === 'report' && data.report.runId !== runId) throw new Error('A auditoria mudou. Atualize o progresso e gere o relatório novamente.')
      if (controller.signal.aborted) return
      if (kind === 'report') { setReport(data.report); setAnswer(null); setAnsweredQuestion('') }
      else { setAnswer({ answer: data.answer, sources: data.sources }); setAnsweredQuestion(question.trim()) }
    } catch (error) {
      if (request.current === controller) setError(controller.signal.aborted ? 'A solicitação demorou mais que o esperado. Tente novamente; a leitura continua salva.'
        : error instanceof Error ? error.message : 'Não foi possível concluir a solicitação.')
    } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(null) } }
  }
  const download = (structured = false) => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([structured ? JSON.stringify(report.forensic, null, 2) : exportAuditReport(report, answer, answeredQuestion)], { type: structured ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${structured ? 'tabela-individual' : 'relatorio-atendimento'}-${report.generatedAt.slice(0, 10)}.${structured ? 'json' : 'txt'}`
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const evidence = (source: ReportExample) => <div key={source.id} className="rounded-lg border border-slate-800 p-3 space-y-2">
    <p className="text-slate-200">[{source.id}] {source.description} · confiança {source.confidence}</p>
    {source.evidence.map((item, index) => <div key={index}><blockquote className="border-l-2 border-emerald-800 pl-2 whitespace-pre-wrap">{item.quote}</blockquote>
      <p className="text-[10px] break-all">Mensagem {item.messageId} · {item.source === 'text' ? 'Texto' : 'Interpretação automática de anexo'}</p></div>)}
    <div className="flex flex-wrap gap-3"><button className="text-emerald-400 underline" onClick={() => onSelect(source.conversationId)}>Conferir evidências desta conversa</button>
      <Link href={`/inbox?conversa=${source.conversationId}`} className="text-emerald-400 underline">Abrir conversa original</Link></div>
  </div>
  return <section aria-label="Relatório e perguntas da auditoria" className="space-y-3 border-t border-slate-800 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-200">Relatório para revisar com a vendedora</h3>
      <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={!!busy || !completed} onClick={() => void execute('report')}>
        {busy === 'report' ? 'Preparando relatório…' : report ? 'Atualizar relatório' : 'Gerar relatório'}</Button>
        {report && <><Button size="sm" variant="ghost" onClick={() => download()}>Baixar relatório</Button><Button size="sm" variant="ghost" onClick={() => download(true)}>Baixar tabela individual</Button></>}</div></div>
    <p>Reúne acertos, pontos a corrigir e o que faltou, com mensagens para conferência e ações sugeridas.</p>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
    {busy && <p role="status">{busy === 'report' ? 'Reunindo os resultados já salvos. A leitura das conversas continua.' : 'A IA está consultando os totais e as evidências deste relatório…'}</p>}
    {report && <>
      <p className="text-slate-200">{report.reviewed < report.total ? 'Relatório parcial' : 'Relatório do inventário completo'}: {report.reviewed}/{report.total} conversas · {report.messages.toLocaleString('pt-BR')} mensagens. Gerado em {new Date(report.generatedAt).toLocaleString('pt-BR')}.</p>
      {completed > report.reviewed && <p className="text-amber-300">Há novas conversas revisadas. Use Atualizar relatório para incluí-las.</p>}
      <p>{report.pending} pendentes · {report.failed} falhas · {report.missingResults} resultados indisponíveis · {report.unreadMedia} anexos não interpretados. Corte: {new Date(report.cutoff).toLocaleString('pt-BR')}.</p>
      {!report.forensic.summary.effective && <p>Resultado da revisão anterior: {report.outcomes.ganha} concluídas · {report.outcomes.aberta} abertas · {report.outcomes.perdida} perdidas. Ainda não representa o placar forense.</p>}
      <p>Avalia o atendimento da loja; não atribui automaticamente mensagens a uma pessoa. Os temas podem se sobrepor e as recomendações são sugestões para a revisão.</p>
      <ForensicReportTable key={report.id} report={report.forensic} />
      {(['acerto', 'erro', 'pendencia'] as const).map(type => <details key={type} className="space-y-3 rounded-lg border border-slate-800 p-3">
        <summary className="cursor-pointer font-semibold text-slate-200">{type === 'acerto' ? 'Acertos para preservar' : type === 'erro' ? 'Pontos a corrigir' : 'O que faltou / pendências'} · {report.topics.filter(topic => topic.type === type).reduce((sum, topic) => sum + topic.occurrences, 0)} ocorrências</summary>
        {!report.topics.some(topic => topic.type === type) && <p>Nenhum achado com evidência nesta categoria. Isso não comprova ausência de problemas.</p>}
        {report.topics.filter(topic => topic.type === type).map(topic => <div key={topic.key} className="space-y-2">
          <h4 className="text-slate-200 font-semibold">{topic.title} · {topic.occurrences} ocorrências em {topic.conversations} conversas</h4>
          <p>Ação sugerida: {topic.recommendation}</p>{topic.examples.map(evidence)}</div>)}
      </details>)}
      {!!report.forensic.summary.effective && <p>Pix confirmado por contexto e emoji: {report.forensic.summary.closingTypes.PIX_CONFIRMADO_POR_EMOJI} vendas entre {report.forensic.summary.effective} conversas auditadas. A classificação exige comprovante interpretado e confirmação contextual; não substitui a conciliação bancária.</p>}
      {!report.forensic.summary.effective && <details className="space-y-2 rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer text-slate-200">Emojis em contexto de Pix · {report.emojiSignals.length} sinais possíveis</summary>
        <p>✅, 👍, ☑ e 👌 enviados após relato de Pix ou possível comprovante são sinais de ciência, com conferência manual. Não confirmam recebimento no banco e não alteram o desfecho da venda. Reações não armazenadas no CRM ficam fora desta leitura.</p>
        {report.emojiSignals.map((signal, index) => <div key={index} className="space-y-2 border-t border-slate-800 pt-2"><p>{signal.description}</p>
          {signal.evidence.map(item => <blockquote key={item.messageId} className="border-l-2 border-emerald-800 pl-2">{item.quote}</blockquote>)}
          {signal.attachmentMessageId && <p>Anexo não conferido: {signal.attachmentMessageId}</p>}
          <Link className="text-emerald-400 underline" href={`/inbox?conversa=${signal.conversationId}`}>Conferir a conversa e o pagamento</Link></div>)}
      </details>}
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); void execute('question') }}>
        <label htmlFor="audit-report-question" className="block font-semibold text-slate-200">Pergunte sobre esta auditoria</label>
        <textarea id="audit-report-question" className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-200" rows={3} maxLength={2000}
          value={question} onChange={event => setQuestion(event.target.value)} placeholder="Quais acertos devemos repetir e quais três melhorias priorizar no atendimento e na confirmação do Pix?" />
        <p>A resposta usa os totais de todas as conversas revisadas e uma seleção de evidências relevantes. Ela fica vinculada à versão deste relatório.</p>
        <Button size="sm" type="submit" disabled={!!busy || question.trim().length < 3 || !!report.missingResults}>Perguntar à IA da auditoria</Button>
      </form>
      {answer && <div className="space-y-3 rounded-lg border border-emerald-900 p-3"><p className="font-semibold text-slate-200">{answeredQuestion}</p>
        <p className="whitespace-pre-wrap text-slate-200">{answer.answer}</p>{answer.sources.map(evidence)}</div>}
    </>}
  </section>
}
