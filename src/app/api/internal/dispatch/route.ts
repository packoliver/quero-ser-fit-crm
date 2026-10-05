import { NextResponse } from 'next/server'
import { processAgentTaskBatch } from '@/lib/ai/task-worker'
import { getQueueHealth } from '@/lib/ai/task-queue'

/**
 * POST /api/internal/dispatch — dispara o worker da fila de tarefas de IA.
 * Chamado por Vercel Cron (a cada 5 min) ou on-demand após eventos críticos.
 *
 * Autenticação: Vercel Cron envia `Authorization: Bearer <CRON_SECRET>`.
 * Também aceita x-internal-secret para chamadas manuais/on-demand.
 */
export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    // Autenticação: CRON_SECRET (Vercel) ou INTERNAL_DISPATCH_SECRET (manual)
    const authHeader = request.headers.get('authorization')
    const internalSecret = request.headers.get('x-internal-secret')
    const cronSecret = process.env.CRON_SECRET
    const dispatchSecret = process.env.INTERNAL_DISPATCH_SECRET

    let authorized = false

    // Vercel Cron: Authorization: Bearer <CRON_SECRET>
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      authorized = true
    }
    // Fallback manual: x-internal-secret header
    if (!authorized && dispatchSecret && internalSecret === dispatchSecret) {
      authorized = true
    }
    // Em desenvolvimento sem secrets configurados, permite acesso local
    if (!authorized && !cronSecret && !dispatchSecret && process.env.NODE_ENV === 'development') {
      authorized = true
    }

    if (!authorized) {
      console.warn('[dispatch] Unauthorized access attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await processAgentTaskBatch(5)
    const durationMs = Date.now() - startTime

    // Logging estruturado para observabilidade
    if (result.processed > 0) {
      console.log(
        `[dispatch] processed=${result.processed} completed=${result.completed} failed=${result.failed} duration_ms=${durationMs}`
      )
    }

    return NextResponse.json({
      success: true,
      ...result,
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const durationMs = Date.now() - startTime
    console.error(`[dispatch] Worker error after ${durationMs}ms:`, err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/internal/dispatch — health check da fila de tarefas.
 * Retorna contagens por status e idade da tarefa pendente mais antiga.
 * Útil para monitoramento e alertas.
 */
export async function GET(request: Request) {
  try {
    // Mesma autenticação do POST
    const authHeader = request.headers.get('authorization')
    const internalSecret = request.headers.get('x-internal-secret')
    const cronSecret = process.env.CRON_SECRET
    const dispatchSecret = process.env.INTERNAL_DISPATCH_SECRET

    let authorized = false
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) authorized = true
    if (!authorized && dispatchSecret && internalSecret === dispatchSecret) authorized = true
    if (!authorized && !cronSecret && !dispatchSecret && process.env.NODE_ENV === 'development') authorized = true

    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const health = await getQueueHealth()
    return NextResponse.json(health)
  } catch (err) {
    console.error('[dispatch-health] Error:', err)
    return NextResponse.json({ error: 'Failed to get queue health' }, { status: 500 })
  }
}