import { NextResponse } from 'next/server'
import { processAgentTaskBatch } from '@/lib/ai/task-worker'

/**
 * Autenticação compartilhada entre GET (Vercel Cron) e POST (manual).
 * Vercel Cron envia `Authorization: Bearer <CRON_SECRET>`.
 * Chamadas manuais podem usar `x-internal-secret` com INTERNAL_DISPATCH_SECRET.
 * Em produção, se nenhum secret estiver configurado, rejeita sempre (fail-closed).
 */
function authorizeRequest(request: Request): boolean {
  const authHeader = request.headers.get('authorization')
  const internalSecret = request.headers.get('x-internal-secret')
  const cronSecret = process.env.CRON_SECRET
  const dispatchSecret = process.env.INTERNAL_DISPATCH_SECRET

  // Vercel Cron: Authorization: Bearer <CRON_SECRET>
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true

  // Manual/on-demand: x-internal-secret header
  if (dispatchSecret && internalSecret === dispatchSecret) return true

  // Dev-only fail-open: apenas quando NENHUM secret está configurado E é development
  if (!cronSecret && !dispatchSecret && process.env.NODE_ENV === 'development') return true

  return false
}

/**
 * GET /api/internal/dispatch — endpoint chamado pelo Vercel Cron.
 * Processa um batch da fila de tarefas de IA e retorna o resumo.
 * Autenticação obrigatória via CRON_SECRET em produção.
 */
export async function GET(request: Request) {
  const startTime = Date.now()

  if (!authorizeRequest(request)) {
    console.warn('[dispatch] Unauthorized GET access attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processAgentTaskBatch(5)
    const durationMs = Date.now() - startTime

    if (result.processed > 0) {
      console.log(
        `[dispatch:cron] processed=${result.processed} completed=${result.completed} failed=${result.failed} duration_ms=${durationMs}`
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
    console.error(`[dispatch:cron] Worker error after ${durationMs}ms:`, err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/internal/dispatch — dispatch manual/on-demand.
 * Mesma lógica de processamento do GET, autenticação independente.
 * Útil para disparar processamento imediato após eventos críticos.
 */
export async function POST(request: Request) {
  const startTime = Date.now()

  if (!authorizeRequest(request)) {
    console.warn('[dispatch] Unauthorized POST access attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processAgentTaskBatch(5)
    const durationMs = Date.now() - startTime

    if (result.processed > 0) {
      console.log(
        `[dispatch:manual] processed=${result.processed} completed=${result.completed} failed=${result.failed} duration_ms=${durationMs}`
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
    console.error(`[dispatch:manual] Worker error after ${durationMs}ms:`, err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 }
    )
  }
}