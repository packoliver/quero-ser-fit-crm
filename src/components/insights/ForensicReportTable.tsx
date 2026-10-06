'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import type { ForensicReport } from '@/lib/ai/audit-forensic-report'
import { ERROR_CODES, SUCCESS_CODES } from '@/lib/ai/audit-forensic'

export function ForensicReportTable({ report }: { report: ForensicReport }) {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const summary = report.summary
  const rows = report.rows.filter(row => filter === 'all' || (filter === 'manual' ? row.manualReview : filter === 'divergence' ? row.crmDivergence : !row.auditedStatus))
  const display = rows.slice(page * 30, page * 30 + 30)
  return <div className="space-y-3 rounded-lg border border-slate-800 p-3">
    <h4 className="font-semibold text-slate-200">Placar forense e tabela individual</h4>
    <p className={summary.complete ? 'text-emerald-300' : 'text-amber-300'}>{summary.complete ? 'Inventário completo, segunda passagem concluída e totais reconciliados.' : 'Auditoria forense ainda não concluída. Resultados anteriores de texto não substituem a leitura multimodal com segunda passagem.'}</p>
    <p>Recebidas: {summary.expected} · efetivamente auditadas: {summary.effective} · não analisadas neste critério: {summary.notAnalyzed}.</p>
    <div className="grid gap-2 sm:grid-cols-5">{Object.entries(summary.counts).map(([status, count]) => <p key={status} className="rounded bg-slate-900 p-2"><span className="block text-[10px]">{status.replaceAll('_', ' ')}</span><strong className="text-lg text-slate-200">{count}</strong></p>)}</div>
    <p>Reconciliação: {Object.values(summary.counts).join(' + ')} = {summary.sum} / {summary.effective} analisadas · {summary.reconciled ? 'OK' : 'DIVERGENTE'}.</p>
    {summary.metrics.map(metric => <p key={metric.status}>{metric.status.replaceAll('_', ' ')}: {metric.numerator}/{metric.denominator} = {metric.percent === null ? 'não calculável' : `${metric.percent.toFixed(2)}%`}.</p>)}
    <p>Denominador: todas as conversas com auditoria forense e segunda passagem, incluindo inconclusivas. {summary.divergences} divergências do CRM · {summary.manualReview} para revisão manual · {summary.unverifiedRelevantImages} com imagem relevante não verificada.</p>
    <details><summary className="cursor-pointer text-slate-200">Ranking de erros e acertos · follow-up · recuperáveis</summary>
      <p className="mt-2">Follow-up realizado: {summary.followUp.confirmed} · ausente: {summary.followUp.absent} · indeterminado: {summary.followUp.unknown}.</p>
      {summary.errors.slice(0, 5).map(item => <p key={item.code}>{item.code} — {ERROR_CODES[item.code as keyof typeof ERROR_CODES]}: {item.conversations} conversas, {item.confirmed} confirmadas e {item.inferred} inferidas.</p>)}
      {summary.strengths.slice(0, 5).map(item => <p key={item.code}>{item.code} — {SUCCESS_CODES[item.code as keyof typeof SUCCESS_CODES]}: {item.conversations} conversas.</p>)}
      <p className="mt-2">{summary.recoverable.length} leads potencialmente recuperáveis; avaliação inferida, sem garantia.</p>
      {summary.recoverable.slice(0, 10).map(lead => <div key={lead.conversationId} className="mt-2 border-t border-slate-800 pt-2"><Link className="text-emerald-400 underline" href={`/inbox?conversa=${lead.conversationId}`}>{lead.priority} · {lead.conversationId.slice(0, 8)}</Link>
        <p>{lead.reason}</p><p>Ação: {lead.action}</p><p>Abordagem sugerida: {lead.suggestedMessage}</p></div>)}
    </details>
    <details><summary className="cursor-pointer text-slate-200">Conferir tabela individual ({report.rows.length} conversas)</summary>
      <label className="block mt-2">Filtrar tabela <select className="ml-2 rounded bg-slate-900 p-2" value={filter} onChange={event => { setFilter(event.target.value); setPage(0) }}>
        <option value="all">Todas</option><option value="manual">Revisão manual</option><option value="divergence">Divergências do CRM</option><option value="missing">Não auditadas no critério forense</option></select></label>
      <div className="overflow-x-auto"><table className="w-full text-left mt-2"><thead><tr><th className="p-2">Conversa</th><th className="p-2">CRM</th><th className="p-2">Auditado</th><th className="p-2">Confiança</th><th className="p-2">Evidência / lacuna</th></tr></thead>
        <tbody>{display.map(row => <tr key={row.conversationId} className="border-t border-slate-800"><td className="p-2"><Link className="text-emerald-400 underline" href={`/inbox?conversa=${row.conversationId}`}>{row.conversationId.slice(0, 8)}</Link><p>{row.channel}</p></td>
          <td className="p-2">{row.crmStatus || 'Não disponível'}</td><td className="p-2">{row.auditedStatus || 'Não auditada'}</td><td className="p-2">{row.confidence || '—'}</td><td className="p-2 min-w-64">{row.reason}<p>{row.imageStatus}</p>{row.crmDivergence && <p className="text-amber-300">Divergência com CRM</p>}</td></tr>)}</tbody></table></div>
      <div className="flex items-center gap-3 mt-2"><Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Anterior</Button>
        <span>Página {page + 1} · {rows.length} conversas neste filtro</span><Button size="sm" variant="ghost" disabled={(page + 1) * 30 >= rows.length} onClick={() => setPage(value => value + 1)}>Próxima</Button></div>
    </details>
  </div>
}
