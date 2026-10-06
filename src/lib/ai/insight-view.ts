export const LOSS_LABELS = {
  cliente_sem_retorno: 'Cliente sem retorno', equipe_sem_resposta: 'Falta de resposta da equipe',
  estoque: 'Produto, tamanho ou cor indisponível', preco: 'Preço ou condições de pagamento',
  prazo: 'Prazo de entrega ou retirada', concorrencia: 'Compra em outra loja',
  outro: 'Outros motivos confirmados', indeterminado: 'Motivo não identificado',
} as const

export function groupLossReasons(rows: { outcomeReason: string | null }[]) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const text = row.outcomeReason?.trim() || ''
    let label: string = Object.values(LOSS_LABELS).find(value => text === value || text.startsWith(`${value} — `)) || ''
    const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (!label) {
      if (!text) label = LOSS_LABELS.indeterminado
      else if (/cliente (?:sumiu|parou de responder)|sem (?:retorno|resposta) (?:do cliente)|nao (?:retornou|respondeu)/.test(normalized)) label = LOSS_LABELS.cliente_sem_retorno
      else if (/estoque|indisponivel|nao (?:possuia|tinha|tem).*(?:modelo|tamanho|cor)/.test(normalized)) label = LOSS_LABELS.estoque
      else if (/preco|caro|pagamento/.test(normalized)) label = LOSS_LABELS.preco
      else if (/prazo|entrega|retirada/.test(normalized)) label = LOSS_LABELS.prazo
      else label = LOSS_LABELS.outro
    }
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
}

export function isInInsightPeriod(lastMessageAt: string | null, days: number | null, asOf: number) {
  if (days === null) return true
  const date = lastMessageAt ? Date.parse(lastMessageAt) : NaN
  return Number.isFinite(date) && date <= asOf && date >= asOf - days * 86_400_000
}
export const PAYMENT_LABELS = {
  sem_indicio: 'Pagamento não identificado no texto',
  pix_solicitado: 'Pix solicitado, sem confirmação',
  relatado_pelo_cliente: 'Cliente informou pagamento',
  comprovante_mencionado: 'Comprovante mencionado, sem conferência',
  confirmado_pela_loja: 'Recebimento confirmado pelo atendente',
  pendente: 'Pagamento ou confirmação pendente',
  estorno_mencionado: 'Estorno mencionado na conversa',
} as const
