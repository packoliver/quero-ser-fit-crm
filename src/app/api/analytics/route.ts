import { NextResponse } from 'next/server'
import { getAuthenticatedUserContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  calculateMetric,
  compareMetric,
  buildPeriod,
  buildPreviousPeriod,
  METRICS,
  type PeriodFilter,
} from '@/lib/analytics/metrics'

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
  const metricIdsParam = searchParams.get('metrics')
  const withComparison = searchParams.get('compare') === 'true'

  // Período padrão: últimos 30 dias se não especificado
  const days = daysParam ? parseInt(daysParam, 10) : 30
  if (isNaN(days) || days < 1 || days > 365) {
    return NextResponse.json(
      { error: 'Parâmetro days deve ser entre 1 e 365.' },
      { status: 400 }
    )
  }

  // Métricas solicitadas: todas se não especificado
  const requestedIds = metricIdsParam
    ? metricIdsParam.split(',').filter((id) => id in METRICS)
    : Object.keys(METRICS)

  if (requestedIds.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma métrica válida solicitada.' },
      { status: 400 }
    )
  }

  try {
    const admin = createAdminClient()
    const currentPeriod = buildPeriod(days)
    const previousPeriod = buildPreviousPeriod(currentPeriod)

    const results: Record<string, unknown> = {}

    for (const metricId of requestedIds) {
      if (withComparison) {
        results[metricId] = await compareMetric(
          admin,
          auth.organizationId,
          metricId,
          currentPeriod,
          previousPeriod
        )
      } else {
        results[metricId] = await calculateMetric(
          admin,
          auth.organizationId,
          metricId,
          currentPeriod
        )
      }
    }

    return NextResponse.json(
      {
        period: currentPeriod,
        comparisonPeriod: withComparison ? previousPeriod : null,
        metrics: results,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[analytics]', message)
    return NextResponse.json(
      { error: 'Não foi possível calcular as métricas.' },
      { status: 500 }
    )
  }
}