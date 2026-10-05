import { NextResponse } from 'next/server'
import { processAgentTaskBatch } from '@/lib/ai/task-worker'

/**
 * POST /api/internal/dispatch — dispara o worker da fila de tarefas de IA.
 * Chamado por cron (Vercel Cron) ou on-demand após eventos críticos
 * (nova mensagem, deal fechado). Idempotente e seguro contra concorrência
 * via FOR UPDATE SKIP LOCKED no banco.
 *
 * Em produção, proteja com header x-internal-secret ou Vercel Cron secret.
 */
export async function POST(request: Request) {
  try {
    // Segurança básica: em produção, valide um secret interno
    const secret = request.headers.get('x-internal-secret')
    const expectedSecret = process.env.INTERNAL_DISPATCH_SECRET
    if (expectedSecret && secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await processAgentTaskBatch(5)

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[dispatch] Erro no worker:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 }
    )
  }
}