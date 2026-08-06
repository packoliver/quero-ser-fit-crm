import { NextRequest, NextResponse } from 'next/server'
import { createConnectionSchema } from '@/lib/validations'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptToken } from '@/lib/security/encryption'
import { verifyCloudApiConnection, verifyZapApiConnection } from '@/lib/integrations/verify-connection'

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
    const { ok: verifyOk, detail: verifyDetail } = await verifyCloudApiConnection(input.externalIdentifier, input.accessToken)

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

  // zapapi: validate the Instance ID/Token against zap-api.tech's own status endpoint,
  // then auto-register our webhook URL on that instance (signed with our shared secret)
  // so the admin doesn't have to configure anything manually on zap-api.tech's side.
  const { ok: zapapiOk, detail: zapapiDetail, webhookWarning } = await verifyZapApiConnection(
    input.instanceId,
    input.instanceToken,
    request.nextUrl.origin
  )

  const { data: inserted, error: insertError } = await adminDb
    .from('integration_connections')
    .insert({
      organization_id: organizationId,
      provider: 'whatsapp_zapapi',
      label: input.label,
      connection_method: 'zapapi',
      external_identifier: input.instanceId,
      encrypted_credentials: encryptToken(input.instanceToken),
      status: zapapiOk ? 'active' : 'error',
      settings: zapapiOk ? {} : { last_verify_error: zapapiDetail },
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
      warning: zapapiOk
        ? webhookWarning
        : `Conexão salva, mas a ZAP API não confirmou o dispositivo conectado: ${zapapiDetail}. Escaneie o QR Code no painel da ZAP API e tente novamente.`,
    },
    { status: 201 }
  )
}
