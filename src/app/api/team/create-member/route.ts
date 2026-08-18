import { NextRequest, NextResponse } from 'next/server'
import { memberCreateSchema } from '@/lib/validations'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/security/audit'

/**
 * POST /api/team/create-member
 *
 * Admin-only endpoint: registers a new team member directly with a temporary password
 * chosen by the admin, instead of the classic "send an invite e-mail" flow. The new
 * member can log in immediately with that password and change it later from their
 * account menu if they want to.
 */
export async function POST(request: NextRequest) {
  try {
    return await handlePost(request)
  } catch (err) {
    console.error('[create-member] Erro inesperado:', err)
    return NextResponse.json({ error: 'Erro inesperado ao cadastrar membro.' }, { status: 500 })
  }
}

async function handlePost(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const parsed = memberCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Dados inválidos.' },
      { status: 400 }
    )
  }
  const { email, fullName, role, password } = parsed.data

  // 1. Identify the caller through the regular, RLS-respecting server client.
  const supabase = await createClient()
  const {
    data: { user: caller },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !caller) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  // 2. Find the caller's organization and confirm they are an admin of it.
  const { data: callerMembership, error: membershipError } = await (supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          limit: (n: number) => {
            maybeSingle: () => Promise<{ data: { organization_id: string; role: string } | null; error: unknown }>
          }
        }
      }
    }
  })
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', caller.id)
    .limit(1)
    .maybeSingle()

  if (membershipError || !callerMembership) {
    return NextResponse.json({ error: 'Organização do usuário não encontrada.' }, { status: 403 })
  }

  const { data: isAdmin, error: isAdminError } = await (supabase as unknown as {
    rpc: (fn: string, params: { org_id: string }) => Promise<{ data: boolean | null; error: unknown }>
  }).rpc('is_org_admin', {
    org_id: callerMembership.organization_id,
  })

  if (isAdminError || !isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem cadastrar novos membros da equipe.' },
      { status: 403 }
    )
  }

  // 3. Create the auth user + profile + membership using the privileged admin client.
  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    console.error('[create-member] Falha ao inicializar cliente administrativo:', err)
    return NextResponse.json({ error: 'Serviço temporariamente indisponível.' }, { status: 500 })
  }

  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (createUserError || !createdUser?.user) {
    const isDuplicate = createUserError?.message?.toLowerCase().includes('already') ?? false
    if (!isDuplicate) console.error('[create-member] Falha ao criar usuário:', createUserError?.message)
    return NextResponse.json(
      { error: isDuplicate ? 'Já existe um usuário cadastrado com este e-mail.' : 'Falha ao criar o usuário.' },
      { status: isDuplicate ? 409 : 500 }
    )
  }

  const newUserId = createdUser.user.id

  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: newUserId, full_name: fullName, email }, { onConflict: 'id' })

  if (profileError) {
    console.error('[create-member] Falha ao criar perfil:', profileError.message)
    await admin.auth.admin.deleteUser(newUserId)
    return NextResponse.json({ error: 'Falha ao criar o perfil do membro.' }, { status: 500 })
  }

  const { error: memberError } = await admin.from('organization_members').insert({
    organization_id: callerMembership.organization_id,
    user_id: newUserId,
    role,
    permissions: null,
  })

  if (memberError) {
    console.error('[create-member] Falha ao vincular à organização:', memberError.message)
    await admin.auth.admin.deleteUser(newUserId)
    return NextResponse.json({ error: 'Falha ao vincular o membro à organização.' }, { status: 500 })
  }

  await logAuditEvent({
    organizationId: callerMembership.organization_id,
    actorId: caller.id,
    action: 'member_created',
    targetType: 'organization_member',
    targetId: newUserId,
    details: { email, fullName, role },
  })

  return NextResponse.json(
    {
      id: newUserId,
      email,
      fullName,
      role,
    },
    { status: 201 }
  )
}
