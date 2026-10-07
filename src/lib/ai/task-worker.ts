import { analyzeConversation, askQuestion } from './client'
import { claimAgentTasks, settleAgentTask, reconcileStaleTasks, type AgentTaskPayload } from './task-queue'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeLeadScoreValue } from './lead-score'
import { determineNextBestAction } from './next-action'
import {
 deriveFollowUpState,
 scoreToTemperature,
 deriveLossReason,
 derivePaymentStage,
} from './commercial-intelligence'
import type { CommercialSignalType } from '@/types/database'

// Versão do analisador comercial — bump quando prompt/regras mudarem
const COMMERCIAL_ANALYSIS_VERSION = 'v1'

// Sinais comerciais que a IA já consegue identificar no prompt atual de analyzeConversation.
// Mapeamento das strings livres do campo `signals` (ex: "objeção de preço") para tipos
// normalizados da tabela commercial_signals. Sinais não mapeados são ignorados — melhor
// perder um sinal incerto do que poluir a tabela com ruído.
const SIGNAL_TYPE_MAP: Record<string, CommercialSignalType> = {
  'objeção de preço': 'OBJECTION_PRICE',
  'objecao de preco': 'OBJECTION_PRICE',
  'preço alto': 'OBJECTION_PRICE',
  'pergunta sobre preço': 'PRICE_ASKED',
  'pergunta sobre preco': 'PRICE_ASKED',
  'cliente esperando': 'WAITING_ATTENDANT_REPLY',
  'esperando resposta': 'WAITING_CUSTOMER_REPLY',
  'pedido de cancelamento': 'CANCELLATION_REQUESTED',
  'cancelamento': 'CANCELLATION_REQUESTED',
  'comprovante pix': 'PAYMENT_EVIDENCE_RECEIVED',
  'comprovante de pagamento': 'PAYMENT_EVIDENCE_RECEIVED',
  'pix enviado': 'PIX_KEY_SENT',
  'chave pix': 'PIX_KEY_SENT',
  'pagamento confirmado': 'PAYMENT_CONFIRMED',
  'pagamento na entrega': 'PAYMENT_ON_DELIVERY',
  'motoboy': 'MOTOBOY_CONFIRMED',
  'retirada': 'PICKUP_CONFIRMED',
  'interesse no produto': 'PRODUCT_INTEREST',
  'tamanho': 'SIZE_SELECTED',
  'cor': 'COLOR_SELECTED',
  'disponibilidade': 'AVAILABILITY_ASKED',
  'frete': 'SHIPPING_ASKED',
  'prazo': 'DELIVERY_DEADLINE_ASKED',
  'endereço': 'ADDRESS_PROVIDED',
  'endereco': 'ADDRESS_PROVIDED',
  'desconto': 'DISCOUNT_ASKED',
  'urgência': 'URGENCY_EXPRESSED',
  'urgencia': 'URGENCY_EXPRESSED',
  'orçamento': 'BUDGET_STATED',
  'orcamento': 'BUDGET_STATED',
  'concorrente': 'COMPETITOR_MENTIONED',
  'depoimento': 'TESTIMONIAL_SHARED',
  'follow-up': 'FOLLOW_UP_SCHEDULED',
  'follow up': 'FOLLOW_UP_SCHEDULED',
  'escalar': 'ESCALATION_NEEDED',
  'escalação': 'ESCALATION_NEEDED',
  // Sinais de objeção específicos — usados por deriveLossReason e lead-score
  'frete caro': 'OBJECTION_SHIPPING',
  'frete alto': 'OBJECTION_SHIPPING',
  'objeção de frete': 'OBJECTION_SHIPPING',
  'prazo longo': 'OBJECTION_DEADLINE',
  'prazo demorado': 'OBJECTION_DEADLINE',
  'objeção de prazo': 'OBJECTION_DEADLINE',
  'produto inadequado': 'OBJECTION_PRODUCT',
  'não serve': 'OBJECTION_PRODUCT',
  'objeção de produto': 'OBJECTION_PRODUCT',
  // Reembolso e desistência — usados por deriveFollowUpState e contradictory signals
  'reembolso': 'REFUND_REQUESTED',
  'devolução': 'REFUND_REQUESTED',
  'quero meu dinheiro': 'REFUND_REQUESTED',
  'desistiu': 'NO_REAL_PURCHASE_INTENT',
  'não quer mais': 'NO_REAL_PURCHASE_INTENT',
  'sem interesse': 'NO_REAL_PURCHASE_INTENT',
  // PIX solicitado pelo cliente — usado por deriveCommercialState e lead-score
  'pediu pix': 'PIX_REQUESTED',
  'quer pix': 'PIX_REQUESTED',
  'solicitou pix': 'PIX_REQUESTED',
}

/** Normaliza uma string de sinal livre para CommercialSignalType ou null se não mapeada. */
function mapSignalToType(raw: string): CommercialSignalType | null {
  const normalized = raw.toLowerCase().trim()
  return SIGNAL_TYPE_MAP[normalized] ?? null
}

// Grupos de sinais que se anulam: ao detectar um novo sinal do grupo, os demais são invalidados.
const CONTRADICTORY_SIGNAL_GROUPS: CommercialSignalType[][] = [
  ['PAYMENT_CONFIRMED', 'CANCELLATION_REQUESTED', 'REFUND_REQUESTED'],
  ['PRODUCT_INTEREST', 'NO_REAL_PURCHASE_INTENT'],
  ['WAITING_ATTENDANT_REPLY', 'WAITING_CUSTOMER_REPLY'],
]

async function invalidateContradictorySignals(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string,
  newSignal: CommercialSignalType
): Promise<void> {
  const group = CONTRADICTORY_SIGNAL_GROUPS.find((g) => g.includes(newSignal))
  if (!group) return
  const toInvalidate = group.filter((s) => s !== newSignal)
  if (toInvalidate.length === 0) return
  await admin
    .from('commercial_signals')
    .update({ invalidated_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('source', 'ai_analysis')
    .is('invalidated_at', null)
    .in('signal_type', toInvalidate)
}

/**
 * Cria tarefa de follow-up automática quando há ação recomendada e nenhuma tarefa aberta.
 * Idempotente: verifica existência de tarefa pendente/in_progress antes de inserir.
 */
async function maybeCreateFollowUpTask(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  conversationId: string,
  nextAction: string | null,
  signals: CommercialSignalType[]
): Promise<void> {
  if (!nextAction) return
  // Verifica se já existe tarefa aberta para esta conversa
  const { data: existing } = await admin
    .from('tasks')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('conversation_id', conversationId)
    .in('status', ['pending', 'in_progress'])
    .limit(1)
  if ((existing ?? []).length > 0) return
  // Determina prioridade baseada em sinais
  const hasUrgency = signals.includes('URGENCY_EXPRESSED') || signals.includes('ESCALATION_NEEDED')
  const hasPayment = signals.includes('PIX_KEY_SENT') || signals.includes('PAYMENT_EVIDENCE_RECEIVED')
  const priority = hasUrgency ? 'alta' : hasPayment ? 'media' : 'baixa'
  const { error } = await admin.from('tasks').insert({
    organization_id: organizationId,
    title: nextAction,
    description: `Follow-up gerado automaticamente pela IA. Sinais detectados: ${signals.slice(0, 5).join(', ')}`,
    status: 'pending',
    priority,
    conversation_id: conversationId,
    due_date: new Date(Date.now() + (hasUrgency ? 3_600_000 : 86_400_000)).toISOString(),
  })
  if (error) {
    console.warn(`[task-worker] Falha ao criar follow-up automático: ${error.message}`)
  }
}

/** Deriva um estado comercial agregado a partir dos sinais persistidos nesta execução.
 *  Estrutura intencionalmente simples — será refinada quando Lead Score for implementado. */
function deriveCommercialState(signals: CommercialSignalType[]): Record<string, unknown> {
  const state: Record<string, unknown> = {}
  if (signals.includes('OBJECTION_PRICE')) state.has_price_objection = true
  if (signals.includes('PAYMENT_CONFIRMED') || signals.includes('PAYMENT_EVIDENCE_RECEIVED')) state.payment_stage = 'confirmed'
  else if (signals.includes('PIX_KEY_SENT')) state.payment_stage = 'pix_sent'
  else if (signals.includes('PIX_REQUESTED')) state.payment_stage = 'pix_requested'
  if (signals.includes('URGENCY_EXPRESSED')) state.urgency = 'high'
  if (signals.includes('CANCELLATION_REQUESTED')) state.cancellation_risk = true
  if (signals.includes('WAITING_ATTENDANT_REPLY')) state.pending_reply = 'attendant'
  else if (signals.includes('WAITING_CUSTOMER_REPLY')) state.pending_reply = 'customer'
  return state
}

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
      // Fencing: passa lease_token para impedir que stale workers finalizem tarefas readquiridas
      const settled = await settleAgentTask(task.id, 'completed', result, undefined, task.lease_token)
      if (settled) completed++
      else failed++
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[task-worker] Falha na tarefa ${task.id} (${task.kind}):`, errorMessage)
      // Fencing: passa lease_token para impedir que stale workers finalizem tarefas readquiridas
      const settled = await settleAgentTask(task.id, 'failed', undefined, errorMessage, task.lease_token)
      if (!settled) {
        console.error(`[task-worker] Não conseguiu finalizar tarefa ${task.id} como failed (possível stale worker)`)
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
        organizationId: payload.organizationId,
        transcript: payload.transcript,
        knownOutcome: payload.knownOutcome ?? null,
      })
      if (!analysis) {
        throw new Error('IA retornou null — gateway não configurado ou erro interno')
      }
      // Persiste o resultado da análise na tabela de insights
      const admin = createAdminClient()

      // Extrai e persiste sinais comerciais estruturados ANTES de atualizar insights,
      // pois commercial_state é derivado dos sinais persistidos nesta execução.
      // Idempotência + Obsolescência: busca apenas sinais ATIVOS (não invalidados)
      const { data: existingSignals } = await admin
        .from('commercial_signals')
        .select('id, signal_type')
        .eq('conversation_id', payload.conversationId)
        .eq('source', 'ai_analysis')
        .is('invalidated_at', null)

      const existingSignalTypes = new Set(
        (existingSignals ?? []).map((s) => s.signal_type as CommercialSignalType)
      )

      const extractedSignals: CommercialSignalType[] = []
      for (const rawSignal of analysis.signals) {
        const signalType = mapSignalToType(rawSignal)
        if (signalType && !existingSignalTypes.has(signalType)) {
          const { error: signalError } = await admin.from('commercial_signals').insert({
            organization_id: payload.organizationId,
            conversation_id: payload.conversationId,
            signal_type: signalType,
            source: 'ai_analysis',
            confidence: 1.0,
            metadata: { analysis_version: COMMERCIAL_ANALYSIS_VERSION },
          })
          if (signalError) {
            console.warn(`[task-worker] Falha ao persistir sinal ${signalType}:`, signalError.message)
          } else {
            // Invalida sinais contraditórios já existentes para esta conversa
            await invalidateContradictorySignals(admin, payload.conversationId, signalType)
            extractedSignals.push(signalType)
            existingSignalTypes.add(signalType)
          }
        } else if (signalType) {
          // Sinal já existe para esta versão — conta como extraído mas não duplica
          extractedSignals.push(signalType)
        }
      }

      // Usa TODOS os sinais conhecidos (novos + existentes) para derivar estado e score
      const allSignalsForConversation = Array.from(existingSignalTypes)
      const commercialState = deriveCommercialState(allSignalsForConversation)
      const leadScore = computeLeadScoreValue(allSignalsForConversation)
      const nextAction = determineNextBestAction(allSignalsForConversation, commercialState)

      // Deriva campos de inteligência comercial determinísticos
      const temperature = scoreToTemperature(leadScore)
      const paymentStage = derivePaymentStage(allSignalsForConversation)

      // Verifica se há tarefa aberta para esta conversa (para follow-up state e loss reason)
      const { data: openTasks } = await admin
        .from('tasks')
        .select('id')
        .eq('organization_id', payload.organizationId)
        .eq('conversation_id', payload.conversationId)
        .in('status', ['pending', 'in_progress'])
        .limit(1)
      const hasOpenTask = ((openTasks ?? []).length > 0)

      // Busca última mensagem para determinar sender e tempo
      const { data: lastMsg } = await admin
        .from('messages')
        .select('sender_type, created_at')
        .eq('organization_id', payload.organizationId)
        .eq('conversation_id', payload.conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const lastMessageSender = (lastMsg?.sender_type as 'contact' | 'user' | 'system' | null) ?? null
      const hoursSinceLastMessage = lastMsg
        ? Math.floor((Date.now() - new Date(lastMsg.created_at).getTime()) / 3_600_000)
        : null

      const followUpState = deriveFollowUpState(
        allSignalsForConversation,
        hasOpenTask,
        hoursSinceLastMessage,
        lastMessageSender
      )

      // Loss reason só se aplica quando outcome é 'perdida'.
      // Usa analysis.outcome (campo validado pelo schema Zod) em vez de status === 'risco',
      // pois uma conversa pode estar em risco sem ter sido perdida.
      const lossReason = deriveLossReason(
        allSignalsForConversation,
        analysis.outcome ?? (analysis.status === 'risco' ? 'perdida' : 'aberta'),
        hoursSinceLastMessage,
        hasOpenTask,
        lastMessageSender
      )
      const lossControllability = lossReason
        ? (await import('./commercial-intelligence')).LOSS_REASON_CONTROLLABILITY[lossReason]
        : null

      const { error } = await admin.from('ai_conversation_insights').upsert(
        {
          organization_id: payload.organizationId,
          conversation_id: payload.conversationId,
          status: analysis.status,
          signals: analysis.signals,
          summary: analysis.summary,
          last_analyzed_at: new Date().toISOString(),
          commercial_state: commercialState,
          lead_score: leadScore,
          next_best_action: nextAction,
          signals_extracted_at: new Date().toISOString(),
          follow_up_state: followUpState,
          temperature,
          payment_stage: paymentStage,
          loss_reason: lossReason,
          loss_controllability: lossControllability,
        },
        { onConflict: 'conversation_id' }
      )
      if (error) throw new Error(`Falha ao persistir insight: ${error.message}`)

      // Gera tarefa de follow-up automática quando há ação recomendada e nenhuma tarefa aberta
      await maybeCreateFollowUpTask(
        admin,
        payload.organizationId,
        payload.conversationId,
        nextAction,
        allSignalsForConversation
      )

      return {
        status: analysis.status,
        signalsCount: analysis.signals.length,
        commercialSignalsExtracted: extractedSignals.length,
        leadScore,
        analysisVersion: COMMERCIAL_ANALYSIS_VERSION,
      }
    }

    case 'qa_question': {
      if (!payload.question || !payload.context) {
        throw new Error('qa_question requer question e context')
      }
      const answer = await askQuestion({
        organizationId: payload.organizationId,
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
