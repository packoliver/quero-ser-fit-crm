import { NextResponse } from 'next/server'
import { getAuthenticatedUserContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculatePaymentMetrics } from '@/lib/analytics/payments'
import { buildPeriod } from '@/lib/analytics/metrics'

export async function GET(request: Request) {
  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (!auth.organizationId || !['admin', 'manager'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const daysParam = searchParams.get('days')
  const days = daysParam ? parseInt(daysParam, 10) : 30

  if (isNaN(days) || days < 1 || days > 365) {
    return NextResponse.json(
      { error: 'Parâmetro days deve ser entre 1 e 365.' },
      { status: 400 }
    )
  }

  try {
    const admin = createAdminClient()
    const period = buildPeriod(days)
    const metrics = await calculatePaymentMetrics(admin, auth.organizationId, period)
    return NextResponse.json(metrics, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[analytics/payments]', message)
    return NextResponse.json(
      { error: 'Não foi possível calcular métricas de pagamento.' },
      { status: 500 }
    )
  }
}