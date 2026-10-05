import { analyzeConversation, askQuestion } from './client'
import { claimAgentTasks, settleAgentTask, reconcileStaleTasks, type AgentTaskPayload } from './task-queue'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Worker que processa tarefas da fila durável de IA.
 * Chamado periodicamente via cron ou on-demand via POST /api/internal/dispatch.
 *
 * Cada tarefa é reivindicada atomicamente (FOR UPDATE SKIP LOCKED),
 * processada e finalizada. Se falhar, volta pra pending com backoff.
 */
export async function processAgentTaskBatch(batchSize = 5): Promise<{
  processed: number
  completed: number
  failed: number
}> {
  // Reconcilia leases expirados antes de reivindicar novas tarefas
  await reconcileStaleTasks()

  const tasks = await claimAgentTasks(batchSize)
  if (tasks.length === 0) return { processed: 0, completed: 0, failed: 0 }

  let completed = 0
  let failed = 0

  for (const task of tasks) {
    try {
      const result = await executeTask(task.kind, task.payload)
      const settled = await settleAgentTask(task.id, 'completed', result)
      if (settled) completed++
      else failed++
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[task-worker] Falha na tarefa ${task.id} (${task.kind}):`, errorMessage)
      const settled = await settleAgentTask(task.id, 'failed', undefined, errorMessage)
      if (!settled) {
        console.error(`[task-worker] Não conseguiu finalizar tarefa ${task.id} como failed`)
      }
      failed++
    }
  }

  return { processed: tasks.length, completed, failed }
}

async function executeTask(
  kind: string,
  payload: AgentTaskPayload
): Promise<Record<string, unknown>> {
  switch (kind) {
    case 'conversation_analysis': {
      if (!payload.conversationId || !payload.transcript) {
        throw new Error('conversation_analysis requer conversationId e transcript')
      }
      const analysis = await analyzeConversation({
        transcript: payload.transcript,
        knownOutcome: payload.knownOutcome ?? null,
      })
      if (!analysis) {
        throw new Error('IA retornou null — gateway não configurado ou erro interno')
      }
      // Persiste o resultado da análise na tabela de insights
      const admin = createAdminClient()
      const { error } = await admin.from('ai_conversation_insights').upsert(
        {
          organization_id: payload.organizationId,
          conversation_id: payload.conversationId,
          status: analysis.status,
          signals: analysis.signals,
          summary: analysis.summary,
          analyzed_at: new Date().toISOString(),
        },
        { onConflict: 'conversation_id' }
      )
      if (error) throw new Error(`Falha ao persistir insight: ${error.message}`)
      return { status: analysis.status, signalsCount: analysis.signals.length }
    }

    case 'qa_question': {
      if (!payload.question || !payload.context) {
        throw new Error('qa_question requer question e context')
      }
      const answer = await askQuestion({
        context: payload.context,
        question: payload.question,
      })
      if (!answer) {
        throw new Error('IA retornou null para qa_question')
      }
      return { answerLength: answer.length }
    }

    case 'backfill_insights': {
      // Backfill é tratado como batch de conversation_analysis individuais
      // Esta tarefa serve apenas como marcador; as análises reais são enfileiradas separadamente
      return { note: 'backfill marker — análises individuais enfileiradas separadamente' }
    }

    default:
      throw new Error(`Tipo de tarefa desconhecido: ${kind}`)
  }
}