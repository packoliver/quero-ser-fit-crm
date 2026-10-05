import { createClient } from '@supabase/supabase-js'
import { getServerEnv } from '@/lib/env'

/**
 * Fila durável de tarefas de IA — substitui chamadas fire-and-forget por um
 * sistema com leasing, retentativas automáticas e reconciliação de workers
 * que morreram mid-processamento. Inspirado no padrão AgentTask do trycompai/crm.
 *
 * Fluxo:
 * 1. enqueueAgentTask() → insere tarefa com status 'pending'
 * 2. claimAgentTasks() → worker atomicamente pega tarefas (FOR UPDATE SKIP LOCKED)
 * 3. processa a tarefa (analyzeConversation, askQuestion, etc.)
 * 4. settleAgentTask() → marca como completed/failed; failed com attempts < max
 *    volta pra pending automaticamente via trigger/RLS
 *
 * A reconciliação de leases expirados roda periodicamente via cron ou on-demand.
 */

export type AgentTaskKind = 'conversation_analysis' | 'backfill_insights' | 'qa_question'

export interface AgentTaskPayload {
  conversationId?: string
  organizationId: string
  transcript?: string
  knownOutcome?: 'ganha' | 'perdida' | null
  question?: string
  context?: string
  [key: string]: unknown
}

interface EnqueueOptions {
  kind: AgentTaskKind
  payload: AgentTaskPayload
  priority?: number // menor = mais urgente. Default 100.
  dueAt?: Date // agendamento futuro. Default now().
}

function getAdminClient() {
  const env = getServerEnv()
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase não configurado para task queue')
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Enfileira uma tarefa de IA para processamento assíncrono durável.
 * Retorna o ID da tarefa criada.
 */
export async function enqueueAgentTask(options: EnqueueOptions): Promise<string | null> {
  try {
    const admin = getAdminClient()
    const { data, error } = await admin
      .from('agent_tasks')
      .insert({
        organization_id: options.payload.organizationId,
        conversation_id: options.payload.conversationId || null,
        kind: options.kind,
        payload: options.payload,
        priority: options.priority ?? 100,
        due_at: options.dueAt?.toISOString() ?? new Date().toISOString(),
        status: 'pending',
        attempts: 0,
        max_attempts: 3,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[task-queue] Erro ao enfileirar tarefa:', error)
      return null
    }

    return data?.id ?? null
  } catch (err) {
    console.error('[task-queue] Erro inesperado ao enfileirar:', err)
    return null
  }
}

/**
 * Reivindica tarefas pendentes para processamento. Usa FOR UPDATE SKIP LOCKED
 * internamente (via RPC claim_agent_tasks) para garantir que dois workers
 * nunca processem a mesma tarefa simultaneamente.
 */
export async function claimAgentTasks(limit = 5, leaseDurationSeconds = 300) {
  try {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('claim_agent_tasks', {
      p_limit: limit,
      p_lease_duration_seconds: leaseDurationSeconds,
    })

    if (error) {
      console.error('[task-queue] Erro ao reivindicar tarefas:', error)
      return []
    }

    return (data || []) as Array<{
      id: string
      organization_id: string
      conversation_id: string | null
      kind: AgentTaskKind
      payload: AgentTaskPayload
      priority: number
      attempts: number
      max_attempts: number
      lease_token: string | null
    }>
  } catch (err) {
    console.error('[task-queue] Erro inesperado ao reivindicar:', err)
    return []
  }
}

/**
 * Finaliza uma tarefa como concluída ou falhada. Se falhada e ainda tiver
 * tentativas restantes, a tarefa volta automaticamente para 'pending' com
 * backoff exponencial (calculado na RPC settle_agent_task).
 */
export async function settleAgentTask(
  taskId: string,
  status: 'completed' | 'failed',
  result?: Record<string, unknown>,
  errorMessage?: string,
  leaseToken?: string | null
): Promise<boolean> {
  try {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('settle_agent_task', {
      p_task_id: taskId,
      p_status: status,
      p_result: result ?? null,
      p_error_message: errorMessage ?? null,
      p_lease_token: leaseToken ?? null,
    })

    if (error) {
      console.error('[task-queue] Erro ao finalizar tarefa:', error)
      return false
    }

    return data === true
  } catch (err) {
    console.error('[task-queue] Erro inesperado ao finalizar:', err)
    return false
  }
}

/**
 * Reconcilia tarefas com lease expirado (workers que morreram sem finalizar).
 * Reseta para 'pending' para que outro worker possa reivindicá-las.
 * Deve ser chamada periodicamente via cron ou endpoint on-demand.
 */
export async function reconcileStaleTasks(): Promise<number> {
  try {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('reconcile_stale_agent_tasks')

    if (error) {
      console.error('[task-queue] Erro ao reconciliar tarefas obsoletas:', error)
      return 0
    }

    return (data as number) ?? 0
  } catch (err) {
    console.error('[task-queue] Erro inesperado ao reconciliar:', err)
    return 0
  }
}

/**
 * Atalho para enfileirar análise de conversa — substitui a chamada direta
 * fire-and-forget em webhooks e páginas.
 */
export async function enqueueConversationAnalysis(params: {
  organizationId: string
  conversationId: string
  transcript: string
  knownOutcome?: 'ganha' | 'perdida' | null
  priority?: number
}): Promise<string | null> {
  return enqueueAgentTask({
    kind: 'conversation_analysis',
    payload: {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      transcript: params.transcript,
      knownOutcome: params.knownOutcome ?? null,
    },
    priority: params.priority ?? 100,
  })
}

/**
 * Health check da fila — retorna contagens por status e idade da tarefa pendente mais antiga.
 * Usado pelo GET /api/internal/dispatch para monitoramento e alertas.
 */
export async function getQueueHealth(): Promise<{
  queued: number
  running: number
  failed: number
  completed_last_24h: number
  oldest_pending_age_seconds: number | null
}> {
  try {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('get_agent_tasks_health')
    if (error) {
      console.error('[task-queue] Erro ao obter health:', error)
      return { queued: -1, running: -1, failed: -1, completed_last_24h: -1, oldest_pending_age_seconds: null }
    }
    // A RPC retorna um único objeto com as contagens
    const row = Array.isArray(data) ? data[0] : data
    return {
      queued: row?.queued ?? 0,
      running: row?.running ?? 0,
      failed: row?.failed ?? 0,
      completed_last_24h: row?.completed_last_24h ?? 0,
      oldest_pending_age_seconds: row?.oldest_pending_age_seconds ?? null,
    }
  } catch (err) {
    console.error('[task-queue] Erro inesperado ao obter health:', err)
    return { queued: -1, running: -1, failed: -1, completed_last_24h: -1, oldest_pending_age_seconds: null }
  }
}