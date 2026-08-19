import { describe, it, expect } from 'vitest'
import { taskTimeBucket } from '@/lib/tasks/buckets'

// Hora fixa no meio de um dia, pra "hoje" não mudar conforme o teste roda de manhã ou à noite.
const AGORA = new Date('2026-08-19T14:30:00')
const bucket = (due: string | null | undefined, status = 'pending') =>
  taskTimeBucket({ status, due_date: due }, AGORA)

describe('Momento da tarefa (Hoje / Atrasada / Próxima / Concluída)', () => {
  it('deve tratar prazo de ontem ou antes como atrasada', () => {
    expect(bucket('2026-08-18T23:59:00')).toBe('overdue')
    expect(bucket('2026-08-01T09:00:00')).toBe('overdue')
  })

  it('deve manter a tarefa em "Hoje" o dia inteiro, mesmo depois do horário marcado', () => {
    // O ponto do teste: são 14:30 e a tarefa era pras 09:00. Comparando por instante ela
    // já estaria "atrasada"; comparando por dia — que é como a vendedora pensa — ela ainda
    // é de hoje. Vira atrasada só quando o dia virar.
    expect(bucket('2026-08-19T09:00:00')).toBe('today')
    expect(bucket('2026-08-19T23:00:00')).toBe('today')
    expect(bucket('2026-08-19T00:01:00')).toBe('today')
  })

  it('deve tratar prazo de amanhã em diante como próxima', () => {
    expect(bucket('2026-08-20T00:30:00')).toBe('upcoming')
    expect(bucket('2026-09-15T09:00:00')).toBe('upcoming')
  })

  it('deve colocar tarefa sem prazo em "Próximas", nunca em "Atrasadas"', () => {
    // Sem data não há como estar atrasada, mas ela precisa aparecer em algum lugar —
    // cair fora de todas as abas faria a tarefa sumir da tela sem ninguém notar.
    expect(bucket(null)).toBe('upcoming')
    expect(bucket(undefined)).toBe('upcoming')
    expect(bucket('')).toBe('upcoming')
  })

  it('deve ignorar data inválida em vez de quebrar a lista', () => {
    expect(bucket('nao-e-uma-data')).toBe('upcoming')
  })

  it('deve classificar como concluída independentemente do prazo', () => {
    // Concluída ganha de tudo: uma tarefa entregue com atraso não pode continuar
    // aparecendo em "Atrasadas" cobrando uma ação que já foi feita.
    expect(bucket('2026-01-01T09:00:00', 'completed')).toBe('completed')
    expect(bucket(null, 'completed')).toBe('completed')
  })

  it('deve manter tarefa em andamento sujeita ao prazo, como qualquer pendente', () => {
    expect(bucket('2026-08-18T09:00:00', 'in_progress')).toBe('overdue')
    expect(bucket('2026-08-19T09:00:00', 'in_progress')).toBe('today')
  })
})
