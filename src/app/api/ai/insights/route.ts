import { NextResponse } from 'next/server'
import { getAuthenticatedUserContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadInsightList } from '@/lib/ai/insight-list'

export async function GET() {
  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!auth.organizationId || !['admin', 'manager'].includes(auth.role || '')) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  try {
    return NextResponse.json({ rows: await loadInsightList(createAdminClient(), auth.organizationId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar os indicadores.' }, { status: 500 })
  }
}
