import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createConnectionSchema } from '@/lib/validations'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptToken } from '@/lib/security/encryption'
import { verifyCloudApiConnection, verifyUazapiConnection } from '@/lib/integrations/verify-connection'
import { logAuditEvent } from '@/lib/security/audit'

interface ConnectionRow {
  id: string
  provider: string
  label: string
  connection_method: string
  external_identifier: string | null
  api_base_url: string | null
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
      select: (cols: string) => { single: () => Promise<{ data: ConnectionRow | null; error: { message: string; code?: string } | null }> }
    }
  }
}

async function getCallerOrganizationId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ organizationId: string; userId: string } | { error: NextResponse }> {
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

  return { organizationId: membership.organization_id, userId: user.id }
}

// Fields returned to the client — encrypted_credentials and webhook_secret are
// intentionally never included (the latter doubles as a bearer credential embedded in
// the webhook URL, since uazapi has no HMAC signing to authenticate it another way).
const SAFE_SELECT = 'id, provider, label, connection_method, external_identifier, api_base_url, status, settings, created_at'

function isDuplicateError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '23505' || !!error.message?.toLowerCase().includes('duplicate')
}

export async function GET() {
  try {
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
      return NextResponse.json({ error: `Falha ao carregar conexões: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ connections: data || [] })
  } catch (err) {
    // Last-resort catch: surface the real message instead of a bare 500 with no body,
    // which is what a raw Next.js route-handler crash looks like to the client.
    return NextResponse.json(
      { error: err instanceof Error ? `Erro inesperado: ${err.message}` : 'Erro inesperado ao carregar conexões.' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
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
    const { organizationId, userId } = result

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
        const isDuplicate = isDuplicateError(insertError)
        return NextResponse.json(
          {
            error: isDuplicate
              ? 'Esse número/página já está cadastrado nesta organização.'
              : `Falha ao salvar a conexão: ${insertError?.message || 'erro desconhecido'}`,
          },
          { status: isDuplicate ? 409 : 500 }
        )
      }

      await logAuditEvent({
        organizationId,
        actorId: userId,
        action: 'integration_connection_created',
        targetType: 'integration_connection',
        targetId: inserted.id,
        details: { provider: input.provider, connectionMethod: 'cloud_api', label: input.label, verified: verifyOk },
      })

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

    // uazapi: each account has its own subdomain, so we validate the base URL/token
    // against that instance's own /instance/status, then register our webhook (the
    // secret embedded in its URL path is generated here, once, and reused on every
    // future re-verify — see verify-connection.ts for why).
    const webhookSecret = randomBytes(24).toString('hex')
    const { ok: uazapiOk, detail: uazapiDetail, webhookWarning, resolvedExternalId } = await verifyUazapiConnection(
      input.apiBaseUrl,
      input.instanceToken,
      request.nextUrl.origin,
      webhookSecret
    )

    const { data: inserted, error: insertError } = await adminDb
      .from('integration_connections')
      .insert({
        organization_id: organizationId,
        provider: 'whatsapp_uazapi',
        label: input.label,
        connection_method: 'uazapi',
        external_identifier: resolvedExternalId || null,
        api_base_url: input.apiBaseUrl,
        webhook_secret: webhookSecret,
        encrypted_credentials: encryptToken(input.instanceToken),
        status: uazapiOk ? 'active' : 'error',
        settings: uazapiOk ? {} : { last_verify_error: uazapiDetail },
      })
      .select(SAFE_SELECT)
      .single()

    if (insertError || !inserted) {
      const isDuplicate = isDuplicateError(insertError)
      return NextResponse.json(
        {
          error: isDuplicate
            ? 'Essa instância já está cadastrada nesta organização.'
            : `Falha ao salvar a conexão: ${insertError?.message || 'erro desconhecido'}`,
        },
        { status: isDuplicate ? 409 : 500 }
      )
    }

    await logAuditEvent({
      organizationId,
      actorId: userId,
      action: 'integration_connection_created',
      targetType: 'integration_connection',
      targetId: inserted.id,
      details: { provider: 'whatsapp_uazapi', connectionMethod: 'uazapi', label: input.label, verified: uazapiOk },
    })

    return NextResponse.json(
      {
        connection: inserted,
        warning: uazapiOk
          ? webhookWarning
          : `Conexão salva, mas o WhatsApp ainda não está conectado nessa instância (${uazapiDetail}). Clique em "Conectar" no card da conexão pra escanear o QR Code.`,
      },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `Erro inesperado: ${err.message}` : 'Erro inesperado ao criar conexão.' },
      { status: 500 }
    )
  }
}
