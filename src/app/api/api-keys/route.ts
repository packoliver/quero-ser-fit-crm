import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasPermission } from '@/lib/security/permissions'
import { generateApiKey } from '@/lib/security/api-keys'
import { logAuditEvent } from '@/lib/security/audit'
import { UserRole, CustomPermissions } from '@/types/database'

interface Membership {
  organization_id: string
  role: UserRole
  permissions: CustomPermissions | null
}

async function requireIntegrationsManager(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return { error: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) } as const

  const db = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => { limit: (n: number) => { maybeSingle: () => Promise<{ data: Membership | null }> } }
      }
    }
  }
  const { data: membership } = await db
    .from('organization_members')
    .select('organization_id, role, permissions')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership || !hasPermission(membership.role, membership.permissions, 'manage_integrations')) {
    return { error: NextResponse.json({ error: 'Apenas administradores podem gerenciar chaves de API.' }, { status: 403 }) } as const
  }

  return { user, membership } as const
}

// Lista as chaves da organização (nunca o valor completo — só id/nome/prefixo/datas).
export async function GET() {
  const supabase = await createClient()
  const auth = await requireIntegrationsManager(supabase)
  if ('error' in auth) return auth.error

  const db = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        order: (col: string, opt: { ascending: boolean }) => Promise<{ data: unknown[] | null }>
      }
    }
  }
  const { data } = await db
    .from('api_keys')
    .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
    .order('created_at', { ascending: false })

  return NextResponse.json({ keys: data || [] })
}

// Cria uma chave nova. O valor em texto puro só existe nesta resposta — o front precisa
// mostrar e avisar o usuário que não dá pra ver de novo depois.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const auth = await requireIntegrationsManager(supabase)
  if ('error' in auth) return auth.error

  let body: { name?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const name = body.name?.trim()
  if (!name) {
    return NextResponse.json({ error: 'Dê um nome pra identificar essa chave (ex: "Zapier", "Planilha de vendas").' }, { status: 400 })
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cliente administrativo indisponível.' },
      { status: 500 }
    )
  }

  const { plaintext, hash, prefix } = generateApiKey()

  const adminDb = admin as unknown as {
    from: (t: string) => {
      insert: (v: Record<string, unknown>) => { select: (c: string) => { single: () => Promise<{ data: { id: string; created_at: string } | null; error: { message: string } | null }> } }
    }
  }
  const { data: inserted, error: insertError } = await adminDb
    .from('api_keys')
    .insert({
      organization_id: auth.membership.organization_id,
      name,
      key_hash: hash,
      key_prefix: prefix,
      created_by: auth.user.id,
    })
    .select('id, created_at')
    .single()

  if (insertError || !inserted) {
    return NextResponse.json({ error: 'Falha ao criar a chave de API.' }, { status: 500 })
  }

  await logAuditEvent({
    organizationId: auth.membership.organization_id,
    actorId: auth.user.id,
    action: 'api_key_created',
    targetType: 'api_key',
    targetId: inserted.id,
    details: { name },
  })

  return NextResponse.json({
    id: inserted.id,
    name,
    key: plaintext,
    prefix,
    createdAt: inserted.created_at,
  })
}
