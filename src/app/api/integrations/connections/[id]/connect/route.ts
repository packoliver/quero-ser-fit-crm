import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/security/encryption'

interface ConnectionRow {
  id: string
  connection_method: string
  api_base_url: string | null
  encrypted_credentials: string | null
}

type AdminDb = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: ConnectionRow | null }> }
      }
    }
    update: (data: unknown) => { eq: (col: string, val: string) => Promise<{ error: unknown }> }
  }
}

async function loadUazapiConnection(id: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }
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
    return { error: NextResponse.json({ error: 'Organização do usuário não encontrada.' }, { status: 403 }) }
  }

  const { data: isAdmin } = await (supabase as unknown as {
    rpc: (fn: string, params: { org_id: string }) => Promise<{ data: boolean | null; error: unknown }>
  }).rpc('is_org_admin', { org_id: membership.organization_id })

  if (!isAdmin) {
    return { error: NextResponse.json({ error: 'Apenas administradores podem gerenciar integrações.' }, { status: 403 }) }
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return { error: NextResponse.json({ error: err instanceof Error ? err.message : 'Cliente administrativo indisponível.' }, { status: 500 }) }
  }

  const adminDb = admin as unknown as AdminDb

  const { data: connection } = await adminDb
    .from('integration_connections')
    .select('id, connection_method, api_base_url, encrypted_credentials')
    .eq('id', id)
    .eq('organization_id', membership.organization_id)
    .maybeSingle()

  if (!connection) {
    return { error: NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 }) }
  }
  if (connection.connection_method !== 'uazapi') {
    return { error: NextResponse.json({ error: 'Essa conexão não usa QR Code.' }, { status: 422 }) }
  }
  if (!connection.api_base_url || !connection.encrypted_credentials) {
    return { error: NextResponse.json({ error: 'Conexão incompleta — remova e cadastre novamente.' }, { status: 422 }) }
  }

  let token: string
  try {
    token = decryptToken(connection.encrypted_credentials)
  } catch {
    return { error: NextResponse.json({ error: 'Falha ao decifrar as credenciais salvas.' }, { status: 500 }) }
  }

  return { adminDb, connection, token }
}

/**
 * POST /api/integrations/connections/[id]/connect
 *
 * Initiates a uazapi QR Code (or pairing code) connection cycle by calling their
 * POST /instance/connect. The frontend then polls GET on this same route to fetch
 * refreshed QR codes and detect when the device connects.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const result = await loadUazapiConnection(id)
    if ('error' in result) return result.error
    const { connection, token } = result

    const base = connection.api_base_url!.replace(/\/$/, '')
    const res = await fetch(`${base}/instance/connect`, {
      method: 'POST',
      headers: { token, 'Content-Type': 'application/json' },
    })
    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      return NextResponse.json({ error: body?.error || `Falha HTTP ${res.status} ao iniciar conexão com a uazapi.` }, { status: 502 })
    }

    return NextResponse.json({
      connected: body?.connected === true,
      qrcode: body?.instance?.qrcode || null,
      paircode: body?.instance?.paircode || null,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `Erro inesperado: ${err.message}` : 'Erro inesperado ao iniciar conexão.' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/integrations/connections/[id]/connect
 *
 * Polling endpoint — asks uazapi for the instance's current status (refreshed QR code
 * while pending, connected:true once the device is paired). Flips our own connection
 * to 'active' the moment it detects a successful connection, so the UI doesn't need a
 * separate "confirm" step.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const result = await loadUazapiConnection(id)
    if ('error' in result) return result.error
    const { adminDb, connection, token } = result

    const base = connection.api_base_url!.replace(/\/$/, '')
    const res = await fetch(`${base}/instance/status`, { headers: { token } })
    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      return NextResponse.json({ error: body?.error || `Falha HTTP ${res.status} ao consultar status na uazapi.` }, { status: 502 })
    }

    const connected = body?.status?.connected === true

    if (connected) {
      await adminDb
        .from('integration_connections')
        .update({ status: 'active', settings: {} })
        .eq('id', connection.id)
    }

    return NextResponse.json({
      connected,
      qrcode: body?.instance?.qrcode || null,
      paircode: body?.instance?.paircode || null,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `Erro inesperado: ${err.message}` : 'Erro inesperado ao consultar status.' },
      { status: 500 }
    )
  }
}
