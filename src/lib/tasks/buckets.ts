/**
 * Em que momento uma tarefa está, do ponto de vista de quem vai executá-la hoje de manhã.
 *
 * As abas da tela de Tarefas eram por status (Pendente / Em Andamento / Concluída), que
 * responde "em que pé está o registro" e não "o que eu preciso fazer agora" — e "atrasada"
 * não existia em lugar nenhum, embora seja justamente a que não pode passar batida. O
 * status continua disponível como filtro avançado.
 */
export type TaskTimeBucket = 'overdue' | 'today' | 'upcoming' | 'completed'

/** O mínimo que este cálculo precisa saber — aceita tanto a tarefa real quanto a de demonstração. */
export interface TaskTimeInput {
  status: string
  /** ISO. Ausente no modo de demonstração, onde o prazo é só texto de exibição ("Hoje, 15:00"). */
  due_date?: string | null
}

/**
 * Tarefa sem prazo cai em "Próximas": ela existe e precisa aparecer em algum lugar, mas não
 * tem como estar atrasada.
 *
 * @param now injetável só pra teste conseguir fixar "hoje"; em produção é sempre a hora atual.
 */
export function taskTimeBucket(task: TaskTimeInput, now: Date = new Date()): TaskTimeBucket {
  if (task.status === 'completed') return 'completed'
  if (!task.due_date) return 'upcoming'

  const due = new Date(task.due_date)
  if (isNaN(due.getTime())) return 'upcoming'

  // Compara por DIA, não por instante: uma tarefa marcada pras 09:00 não vira "atrasada"
  // às 09:01 — ela é de hoje até o dia virar.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000)

  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  return 'upcoming'
}
