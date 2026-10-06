import type { AuditReport, AuditReportAnswer } from './audit-report'
import { PAYMENT_LABELS } from './insight-view'

export type AuditReportPresentation = Omit<AuditReport, 'sources'>
export function exportAuditReport(report: AuditReportPresentation, answer?: AuditReportAnswer | null, question?: string) {
  const lines = ['RELATÓRIO DE REVISÃO DO ATENDIMENTO — QUERO SER FIT',
    `Gerado em: ${new Date(report.generatedAt).toLocaleString('pt-BR')}`,
    `Mensagens até: ${new Date(report.cutoff).toLocaleString('pt-BR')}`,
    `Cobertura: ${report.reviewed}/${report.total} conversas; ${report.messages} mensagens revisadas.`,
    `Pendentes: ${report.pending}; falhas: ${report.failed}; resultados indisponíveis: ${report.missingResults}; anexos não interpretados: ${report.unreadMedia}.`,
    report.reviewed < report.total ? 'RELATÓRIO PARCIAL: conclusões limitadas às conversas com resultado disponível.' : 'Todas as conversas do inventário possuem resultado disponível.',
    report.channels.map(item => `${item.channel}: ${item.reviewed}/${item.total}`).join('; '), '',
    'VENDAS E PAGAMENTOS', `Venda concluída no texto: ${report.outcomes.ganha}; aberta: ${report.outcomes.aberta}; perdida: ${report.outcomes.perdida}.`,
    ...Object.entries(PAYMENT_LABELS).map(([key, label]) => `${label}: ${report.payments[key as keyof typeof PAYMENT_LABELS] || 0}`), '',
    'Este relatório avalia atendimentos, sem atribuir automaticamente cada mensagem a uma pessoa. As categorias podem se sobrepor. Contagens de ocorrências não são contagens de vendas.',
    'Um emoji pode sinalizar ciência pelo contexto. Não foi feita conferência bancária. Reações ausentes do CRM e conteúdo de anexos não interpretados não são evidência de confirmação.', '']
  const forensic = report.forensic.summary
  lines.push('PLACAR FORENSE E RECONCILIAÇÃO', forensic.complete ? 'AUDITORIA FORENSE CONCLUÍDA NO INVENTÁRIO DO CORTE.' : 'AUDITORIA FORENSE NÃO CONCLUÍDA. Este material é preliminar; não representa uma conclusão gerencial final.',
    `Recebidas: ${forensic.expected}; efetivamente auditadas com segunda passagem: ${forensic.effective}; não analisadas neste critério: ${forensic.notAnalyzed}.`,
    ...Object.entries(forensic.counts).map(([status, count]) => `${status}: ${count}`),
    `Validação: ${Object.values(forensic.counts).join(' + ')} = ${forensic.sum}; efetivamente analisadas = ${forensic.effective}; reconciliação: ${forensic.reconciled ? 'OK' : 'DIVERGENTE'}.`,
    ...forensic.metrics.map(metric => `${metric.status}: ${metric.numerator}/${metric.denominator} = ${metric.percent === null ? 'não calculável' : `${metric.percent.toFixed(2)}%`}; denominador: conversas com auditoria forense individual e segunda passagem.`),
    'Conversas que correspondem a grupos ou não têm intenção comercial identificável também podem estar no denominador; ver INCONCLUSIVA antes de usar a taxa como desempenho.', '',
    'FORMAS E EVIDÊNCIAS DE FECHAMENTO', ...Object.entries(forensic.closingTypes).map(([type, count]) => `${type}: ${count}`),
    `Vendas por Pix: ${forensic.pixSales}; pagamento na entrega: ${forensic.paymentOnDelivery}; envolvendo motoboy: ${forensic.motoboy}. Estas contagens podem se sobrepor.`, '',
    'FUNIL (SINAIS OBSERVADOS, SEM PRESUMIR UMA SEQUÊNCIA)', ...forensic.funnel.map(stage => `${stage.stage}: ${stage.count}/${stage.denominator}; não identificado: ${stage.unknown}.`),
    'Não é possível calcular conversão entre etapas como se fossem sequenciais sem vínculo inequívoco ao mesmo pedido. Compare a tabela individual antes de atribuir vazamentos.', '',
    'MOTIVOS DE PERDA E ABANDONO', ...forensic.lossReasons.map(loss => `${loss.reason}: ${loss.count}/${loss.denominator} = ${loss.denominator ? (loss.count / loss.denominator * 100).toFixed(2) : '0'}%; controláveis: ${loss.controllable}; não controláveis: ${loss.uncontrollable}; indeterminadas: ${loss.indeterminate}; exemplos: ${loss.examples.join(', ')}.`), '',
    'CINCO MAIORES ERROS OBSERVADOS/INFERIDOS', ...forensic.errors.slice(0, 5).map(item => `${item.code}: ${item.conversations} conversas; fatos confirmados: ${item.confirmed}; inferências: ${item.inferred}; ${item.possibleAffectedSales} dessas conversas terminaram perdidas ou abandonadas (associação, não prova de causalidade); exemplos: ${item.examples.join(', ')}.`), '',
    'CINCO MAIORES ACERTOS', ...forensic.strengths.slice(0, 5).map(item => `${item.code}: ${item.conversations} conversas; confirmados: ${item.confirmed}; inferidos: ${item.inferred}; exemplos: ${item.examples.join(', ')}.`), '',
    'FOLLOW-UP', `Realizado: ${forensic.followUp.confirmed}; não identificado como realizado: ${forensic.followUp.absent}; indeterminado: ${forensic.followUp.unknown}.`, '',
    'AUDITORIA DE QUALIDADE DO CRM', `Divergências: ${forensic.divergences}; status original indisponível: ${forensic.unknownCrmStatus}. O funil não foi alterado automaticamente.`,
    forensic.duplicates, forensic.attribution, '', 'LEADS POTENCIALMENTE RECUPERÁVEIS — INFERÊNCIA, SEM GARANTIA DE CONVERSÃO',
    ...forensic.recoverable.flatMap(lead => [`${lead.conversationId} — ${lead.priority}; última interação: ${lead.lastInteraction || 'indisponível'}; objeção: ${lead.objection || 'indeterminada'}.`,
      `Motivo: ${lead.reason}`, `Ação: ${lead.action}`, `Mensagem sugerida (revisar antes de enviar): ${lead.suggestedMessage}`]), '',
    'REVISÃO MANUAL E LACUNAS', `${forensic.manualReview} conversas na fila; ${forensic.unverifiedRelevantImages} com imagem relevante não verificada.`,
    ...forensic.notAnalyzedIds.map(item => `${item.conversationId}: ${item.reason}`), '')
  for (const type of ['acerto', 'erro', 'pendencia'] as const) {
    lines.push(type === 'acerto' ? 'ACERTOS PARA PRESERVAR' : type === 'erro' ? 'PONTOS A CORRIGIR' : 'O QUE FALTOU / PENDÊNCIAS')
    const groups = report.topics.filter(topic => topic.type === type)
    if (!groups.length) lines.push('Nenhum achado com evidência nesta categoria. Isso não comprova ausência de problemas.')
    for (const topic of groups) {
      lines.push(`${topic.title}: ${topic.occurrences} ocorrências em ${topic.conversations} conversas.`, `Ação sugerida: ${topic.recommendation}`)
      for (const example of topic.examples) {
        lines.push(`Exemplo ${example.id} (${example.channel}; confiança ${example.confidence}): ${example.description}`, `Conversa: ${example.conversationId}`)
        for (const evidence of example.evidence) lines.push(`Mensagem ${evidence.messageId} (${evidence.source}): ${evidence.quote}`)
      }
      lines.push('')
    }
  }
  lines.push('EMOJIS EM CONTEXTO DE PIX', `${report.emojiSignals.length} possíveis sinais de ciência. Não alteram a classificação da venda ou do recebimento.`)
  for (const signal of report.emojiSignals) {
    lines.push(`Conversa ${signal.conversationId}: ${signal.description}`)
    for (const evidence of signal.evidence) lines.push(`Mensagem ${evidence.messageId}: ${evidence.quote}`)
    if (signal.attachmentMessageId) lines.push(`Anexo a conferir: mensagem ${signal.attachmentMessageId}`)
  }
  lines.push('', 'ROTEIRO PARA A CONVERSA COM A VENDEDORA', '1. Conferir os exemplos e perguntar se falta contexto.',
    '2. Reconhecer os acertos antes de combinar melhorias.', '3. Escolher até três ações, definir responsável e prazo.',
    '4. Padronizar a confirmação escrita do Pix após conferir o banco.', '5. Atualizar a auditoria e verificar se as pendências foram resolvidas.')
  lines.push('', 'PLANO DE AÇÃO', 'CRÍTICO — conferir pagamentos/desfechos divergentes antes de alterar CRM ou cobrar cliente; medir pendências de pagamento e divergências resolvidas.',
    'ALTO — revisar leads recuperáveis e combinar retorno autorizado; medir follow-up realizado e conversão após orçamento.',
    'MÉDIO — treinar com erros/acertos sustentados pelos exemplos; medir tempo de resposta, conversão, abandono e clareza da confirmação de pedido.',
    'Os achados e exemplos acima são a evidência; a tabela individual em JSON permite conferir cada caso. Não há estimativa de faturamento ou promessa de recuperação.')
  if (answer) {
    lines.push('', `PERGUNTA: ${question || ''}`, answer.answer)
    for (const source of answer.sources) {
      lines.push(`Fonte ${source.id}; conversa ${source.conversationId}: ${source.description}`)
      for (const evidence of source.evidence) lines.push(`Mensagem ${evidence.messageId}: ${evidence.quote}`)
    }
  }
  return lines.join('\n')
}
