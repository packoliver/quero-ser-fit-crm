import { BadgeProps } from '@/components/ui/Badge'

export type StageColor = NonNullable<BadgeProps['variant']>

export const STAGE_COLOR_OPTIONS: StageColor[] = ['slate', 'amber', 'emerald', 'teal', 'indigo', 'rose', 'pink']

/**
 * Fundo do pontinho que indica a etapa quando não cabe uma etiqueta inteira — no cabeçalho
 * da conversa, por exemplo, onde o espaço é do nome do cliente.
 *
 * Escrito por extenso porque o Tailwind lê as classes no código-fonte em tempo de build:
 * montar `bg-${color}-400` em tempo de execução geraria uma classe que não existe na folha
 * de estilo, e o pontinho sairia invisível.
 */
export const STAGE_DOT_CLASS: Record<StageColor, string> = {
  slate: 'bg-slate-400',
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
  teal: 'bg-teal-400',
  indigo: 'bg-indigo-400',
  rose: 'bg-rose-400',
  pink: 'bg-pink-400',
}

export interface PipelineStage {
  id: string
  key: string
  label: string
  color: StageColor
  position: number
  isWon: boolean
  isLost: boolean
}

// Linha crua como ela vem do Supabase (snake_case) — convertida pra PipelineStage
// (camelCase) por mapPipelineStageRow logo abaixo.
export interface PipelineStageRow {
  id: string
  key: string
  label: string
  color: string
  position: number
  is_won: boolean
  is_lost: boolean
}

export function mapPipelineStageRow(row: PipelineStageRow): PipelineStage {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    color: (STAGE_COLOR_OPTIONS as string[]).includes(row.color) ? (row.color as StageColor) : 'slate',
    position: row.position,
    isWon: row.is_won,
    isLost: row.is_lost,
  }
}

// Usado no modo demo (sem organização real por trás) e como rede de segurança antes de
// qualquer etapa real carregar — as mesmas 6 etapas que eram fixas no código antes desta
// feature, então nada muda visualmente pra quem já usava o CRM.
export const DEFAULT_PIPELINE_STAGES: PipelineStage[] = [
  { id: 'default-lead', key: 'lead', label: 'Lead', color: 'slate', position: 0, isWon: false, isLost: false },
  { id: 'default-negociando', key: 'negociando', label: 'Negociando', color: 'amber', position: 1, isWon: false, isLost: false },
  { id: 'default-fechado', key: 'fechado', label: 'Fechado', color: 'emerald', position: 2, isWon: true, isLost: false },
  { id: 'default-entrega', key: 'entrega', label: 'Entrega', color: 'teal', position: 3, isWon: false, isLost: false },
  { id: 'default-posvenda', key: 'posvenda', label: 'Pós-venda', color: 'indigo', position: 4, isWon: false, isLost: false },
  { id: 'default-perdido', key: 'perdido', label: 'Perdido', color: 'rose', position: 5, isWon: false, isLost: true },
]

const DIACRITICS_REGEX = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g')

/** Deriva uma `key` estável (slug) a partir do rótulo digitado pelo admin — ex: "Faltando
 * pecas" -> "faltando_pecas". `existingKeys` evita colisão quando duas etapas geram o
 * mesmo slug (ex: "Pos-venda" e "Pos venda"), sufixando com _2, _3... */
export function slugifyStageKey(label: string, existingKeys: string[] = []): string {
  const stripped = label.normalize('NFD').replace(DIACRITICS_REGEX, '')
  const base = stripped.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'etapa'

  if (!existingKeys.includes(base)) return base
  let n = 2
  while (existingKeys.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}
