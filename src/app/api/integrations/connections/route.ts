import { NextRequest, NextResponse } from 'next/server'
import { createConnectionSchema } from '@/lib/validations'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptToken } from '@/lib/security/encryption'

interface ConnectionRow {
  id: string
  provider: string
  label: string
  connection_method: string
  external_identifier: string | null
  status: string
  settings: Record<string, unknown> | null
  created_at: string
}

// integration_connections intentionally has SELECT revoked for the `authenticated`
// Postgres role at the database level (see master_setup.sql) because it holds
// encrypted_credentials — a real secret, even encrypted. Reads/writes here go through
// the service-role admin client instead, with organization scoping done explicitly in
// application code and encrypted_credentials never included in SAFE_SELECT.
type AdminTyped = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        order: (col: string, opt: { ascending: boolean }) => Promise<{ data: ConnectionRow[] | null; error: { message: string } | null }>
      }
    }
    insert: (data: unknown) => {
      select: (cols: string) => { single: () => Promise<{ data: ConnectionRow | null; error: { message: string } | null }> }
    }
  }
}

async function getCallerOrganizationId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ organizationId: string } | { error: NextResponse }> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }
  }

  const { data: membership, error: membershipError } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          limit: (n: number) => { maybeSingle: () => Promise<{ data: { organization_id: string } | null; error: unknown }> }
        }
      }
    }
  })
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (membershipError || !membership) {
    return { error: NextResponse.json({ error: 'Organização do usuário não encontrada.' }, { status: 403 }) }
  }

  return { organizationId: membership.organization_id }
}

// Fields returned to the client — encrypted_credentials is intentionally never included.
const SAFE_SELECT = 'id, provider, label, connection_method, external_identifier, status, settings, created_at'

export async function GET() {
  const supabase = await createClient()
  const result = await getCallerOrganizationId(supabase)
  if ('error' in result) return result.error

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cliente administrativo indisponível.' },
      { status: 500 }
    )
  }

  const { data, error } = await (admin as unknown as AdminTyped)
    .from('integration_connections')
    .select(SAFE_SELECT)
    .eq('organization_id', result.organizationId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Falha ao carregar conexões.' }, { status: 500 })
  }

  return NextResponse.json({ connections: data || [] })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const parsed = createConnectionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, { status: 400 })
  }

  const supabase = await createClient()
  const result = await getCallerOrganizationId(supabase)
  if ('error' in result) return result.error
  const { organizationId } = result

  // Only admins may register/change integrations.
  const { data: isAdmin } = await (supabase as unknown as {
    rpc: (fn: string, params: { org_id: string }) => Promise<{ data: boolean | null; error: unknown }>
  }).rpc('is_org_admin', { org_id: organizationId })

  if (!isAdmin) {
    return NextResponse.json({ error: 'Apenas administradores podem gerenciar integrações.' }, { status: 403 })
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
  const adminDb = admin as unknown as AdminTyped

  const input = parsed.data

  if (input.connectionMethod === 'cloud_api') {
    // Validate the token/identifier actually work against Meta's Graph API before saving.
    let verifyOk = false
    let verifyDetail = ''
    try {
      const verifyRes = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(input.externalIdentifier)}?fields=id`,
        { headers: { Authorization: `Bearer ${input.accessToken}` } }
      )
      const verifyBody = await verifyRes.json().catch(() => ({}))
      verifyOk = verifyRes.ok
      verifyDetail = verifyOk ? '' : verifyBody?.error?.message || `HTTP ${verifyRes.status}`
    } catch (err) {
      verifyDetail = err instanceof Error ? err.message : 'Falha de rede ao validar com a Meta.'
    }

    const { data: inserted, error: insertError } = await adminDb
      .from('integration_connections')
      .insert({
        organization_id: organizationId,
        provider: input.provider,
        label: input.label,
        connection_method: 'cloud_api',
        external_identifier: input.externalIdentifier,
        encrypted_credentials: encryptToken(input.accessToken),
        status: verifyOk ? 'active' : 'error',
        settings: verifyOk ? {} : { last_verify_error: verifyDetail },
      })
      .select(SAFE_SELECT)
      .single()

    if (insertError || !inserted) {
      const isDuplicate = insertError?.message?.includes('duplicate') ?? false
      return NextResponse.json(
        { error: isDuplicate ? 'Esse número/página já está cadastrado nesta organização.' : 'Falha ao salvar a conexão.' },
        { status: isDuplicate ? 409 : 500 }
      )
    }

    return NextResponse.json(
      {
        connection: inserted,
        warning: verifyOk
          ? undefined
          : `Conexão salva, mas a Meta recusou o token/identificador ao validar: ${verifyDetail}. Corrija e tente de novo.`,
      },
      { status: 201 }
    )
  }

  // zapi: validate the Instance ID/Token by asking Z-API for the connected device before saving.
  let zapiOk = false
  let zapiDetail = ''
  try {
    const deviceRes = await fetch(
      `https://api.z-api.io/instances/${encodeURIComponent(input.instanceId)}/token/${encodeURIComponent(input.instanceToken)}/device`,
      {
        headers: input.clientToken ? { 'Client-Token': input.clientToken } : undefined,
      }
    )
    const deviceBody = await deviceRes.json().catch(() => ({}))
    zapiOk = deviceRes.ok && !!deviceBody?.phone
    zapiDetail = zapiOk
      ? ''
      : deviceBody?.error || deviceBody?.message || `HTTP ${deviceRes.status} — instância não conectada ou credenciais inválidas`
  } catch (err) {
    zapiDetail = err instanceof Error ? err.message : 'Falha de rede ao validar com a Z-API.'
  }

  const { data: inserted, error: insertError } = await adminDb
    .from('integration_connections')
    .insert({
      organization_id: organizationId,
      provider: 'whatsapp_zapi',
      label: input.label,
      connection_method: 'zapi',
      external_identifier: input.instanceId,
      encrypted_credentials: encryptToken(JSON.stringify({ instanceToken: input.instanceToken, clientToken: input.clientToken || '' })),
      status: zapiOk ? 'active' : 'error',
      settings: zapiOk ? {} : { last_verify_error: zapiDetail },
    })
    .select(SAFE_SELECT)
    .single()

  if (insertError || !inserted) {
    const isDuplicate = insertError?.message?.includes('duplicate') ?? false
    return NextResponse.json(
      { error: isDuplicate ? 'Essa Instance ID já está cadastrada nesta organização.' : 'Falha ao salvar a conexão.' },
      { status: isDuplicate ? 409 : 500 }
    )
  }

  return NextResponse.json(
    {
      connection: inserted,
      warning: zapiOk
        ? undefined
        : `Conexão salva, mas a Z-API não confirmou o dispositivo conectado: ${zapiDetail}. Escaneie o QR Code no painel da Z-API e tente novamente.`,
    },
    { status: 201 }
  )
}
