import { NextResponse } from 'next/server'
import { getQueueHealth } from '@/lib/ai/task-queue'

/**
 * GET /api/internal/queue-health — health check da fila de tarefas.
 * Retorna contagens por status e idade da tarefa pendente mais antiga.
 * Autenticação obrigatória via CRON_SECRET ou INTERNAL_DISPATCH_SECRET.
 * Em produção sem secrets configurados, rejeita sempre (fail-closed).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const internalSecret = request.headers.get('x-internal-secret')
  const cronSecret = process.env.CRON_SECRET
  const dispatchSecret = process.env.INTERNAL_DISPATCH_SECRET

  let authorized = false
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) authorized = true
  if (!authorized && dispatchSecret && internalSecret === dispatchSecret) authorized = true
  // Dev-only fail-open: apenas quando NENHUM secret está configurado E é development
  if (!authorized && !cronSecret && !dispatchSecret && process.env.NODE_ENV === 'development') {
    authorized = true
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const health = await getQueueHealth()
    return NextResponse.json(health)
  } catch (err) {
    console.error('[queue-health] Error:', err)
    return NextResponse.json({ error: 'Failed to get queue health' }, { status: 500 })
  }
}