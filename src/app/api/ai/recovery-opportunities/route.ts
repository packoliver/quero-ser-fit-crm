import { NextResponse } from 'next/server'
import { getAuthenticatedUserContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadRecoveryOpportunities } from '@/lib/ai/recovery-opportunities'

export async function GET() {
  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!auth.organizationId || !['admin', 'manager'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }
  try {
    const opportunities = await loadRecoveryOpportunities(createAdminClient(), auth.organizationId)
    return NextResponse.json({ opportunities }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[recovery-opportunities]', message)
    return NextResponse.json({ error: 'Não foi possível carregar oportunidades de recuperação.' }, { status: 500 })
  }
}