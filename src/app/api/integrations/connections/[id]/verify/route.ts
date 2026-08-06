import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/security/encryption'
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
  encrypted_credentials: string | null
}

const SAFE_SELECT = 'id, provider, label, connection_method, external_identifier, status, settings, created_at'

/**
 * POST /api/integrations/connections/[id]/verify
 *
 * Re-runs the same validation (and, for ZAP API, webhook re-registration) done at
 * creation time, using the credentials already stored — no need to re-enter them. This
 * exists specifically for the case where a connection was saved while the device
 * wasn't connected yet (e.g. the QR Code hadn't been scanned): it stays 'error'
 * forever otherwise, with no way to recover short of deleting and recreating it.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
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

    const adminDb = admin as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: ConnectionRow | null }> }
          }
        }
        update: (data: unknown) => {
          eq: (col: string, val: string) => { select: (cols: string) => { single: () => Promise<{ data: ConnectionRow | null; error: { message: string } | null }> } }
        }
      }
    }

    const { data: connection } = await adminDb
      .from('integration_connections')
      .select('id, provider, label, connection_method, external_identifier, status, settings, created_at, encrypted_credentials')
      .eq('id', id)
      .eq('organization_id', membership.organization_id)
      .maybeSingle()

    if (!connection) {
      return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 })
    }
    if (!connection.encrypted_credentials || !connection.external_identifier) {
      return NextResponse.json({ error: 'Conexão sem credenciais salvas — remova e cadastre novamente.' }, { status: 422 })
    }

    let token: string
    try {
      token = decryptToken(connection.encrypted_credentials)
    } catch {
      return NextResponse.json({ error: 'Falha ao decifrar as credenciais salvas.' }, { status: 500 })
    }

    let ok: boolean
    let detail: string
    let webhookWarning: string | undefined

    if (connection.connection_method === 'zapapi') {
      const result = await verifyZapApiConnection(connection.external_identifier, token, request.nextUrl.origin)
      ok = result.ok
      detail = result.detail
      webhookWarning = result.webhookWarning
    } else {
      const result = await verifyCloudApiConnection(connection.external_identifier, token)
      ok = result.ok
      detail = result.detail
    }

    const { data: updated, error: updateError } = await adminDb
      .from('integration_connections')
      .update({
        status: ok ? 'active' : 'error',
        settings: ok ? {} : { last_verify_error: detail },
      })
      .eq('id', id)
      .select(SAFE_SELECT)
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: `Falha ao atualizar o status da conexão: ${updateError?.message || 'erro desconhecido'}` }, { status: 500 })
    }

    return NextResponse.json({
      connection: updated,
      warning: ok ? webhookWarning : `Ainda não confirmado: ${detail}.`,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `Erro inesperado: ${err.message}` : 'Erro inesperado ao reverificar conexão.' },
      { status: 500 }
    )
  }
}
