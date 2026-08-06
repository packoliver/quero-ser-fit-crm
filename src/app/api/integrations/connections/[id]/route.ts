import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: membership } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          limit: (n: number) => { maybeSingle: () => Promise<{ data: { organization_id: string } | null }> }
        }
      }
    }
  })
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Organização do usuário não encontrada.' }, { status: 403 })
  }

  const { data: isAdmin } = await (supabase as unknown as {
    rpc: (fn: string, params: { org_id: string }) => Promise<{ data: boolean | null; error: unknown }>
  }).rpc('is_org_admin', { org_id: membership.organization_id })

  if (!isAdmin) {
    return NextResponse.json({ error: 'Apenas administradores podem remover integrações.' }, { status: 403 })
  }

  // integration_connections has SELECT revoked for `authenticated` at the DB level
  // (holds encrypted_credentials), so the delete + its read-back go through the
  // service-role admin client. Org ownership was already confirmed above.
  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cliente administrativo indisponível.' },
      { status: 500 }
    )
  }

  const { data: deleted, error: deleteError } = await (admin as unknown as {
    from: (table: string) => {
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            select: (cols: string) => Promise<{ data: { id: string }[] | null; error: { message: string } | null }>
          }
        }
      }
    }
  })
    .from('integration_connections')
    .delete()
    .eq('id', id)
    .eq('organization_id', membership.organization_id)
    .select('id')

  if (deleteError) {
    return NextResponse.json({ error: 'Falha ao remover a conexão.' }, { status: 500 })
  }

  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
