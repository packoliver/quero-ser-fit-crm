import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthenticatedUserContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptToken } from '@/lib/security/encryption'
import {
  exchangeMetaInstagramCode,
  fetchInstagramProfile,
  META_OAUTH_STATE_COOKIE,
  verifyMetaOAuthState,
} from '@/lib/integrations/meta-oauth'
import { logAuditEvent } from '@/lib/security/audit'

function redirect(request: Request, key: 'meta_success' | 'meta_error', value: string) {
  const url = new URL('/configuracoes/integracoes', request.url)
  url.searchParams.set(key, value)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const cookieStore = await cookies()
  const state = requestUrl.searchParams.get('state')
  const cookieState = cookieStore.get(META_OAUTH_STATE_COOKIE)?.value

  // Delete before any remote call: a callback can never be replayed with this browser cookie.
  cookieStore.delete(META_OAUTH_STATE_COOKIE)

  if (!state || !cookieState || state !== cookieState) {
    return redirect(request, 'meta_error', 'Autorização expirada ou inválida. Tente conectar novamente.')
  }

  const statePayload = verifyMetaOAuthState(state)
  if (!statePayload) {
    return redirect(request, 'meta_error', 'Autorização expirada ou inválida. Tente conectar novamente.')
  }

  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated || auth.userId !== statePayload.userId || auth.organizationId !== statePayload.organizationId) {
    return redirect(request, 'meta_error', 'A sessão do CRM mudou. Inicie a conexão novamente.')
  }
  if (auth.role !== 'admin' && auth.role !== 'manager') {
    return redirect(request, 'meta_error', 'Você não tem permissão para conectar integrações.')
  }

  const providerError = requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error')
  const code = requestUrl.searchParams.get('code')
  if (providerError || !code) {
    return redirect(request, 'meta_error', providerError || 'A autorização do Instagram foi cancelada.')
  }

  try {
    const { accessToken, userId } = await exchangeMetaInstagramCode(code)
    // `userId` returned by Instagram is the external Instagram account ID, not
    // the CRM auth user ID stored in the signed state. The profile lookup below
    // is the source of truth for the connection identifier.
    void userId
    const profile = await fetchInstagramProfile(accessToken)
    const admin = createAdminClient()
    const db = admin as unknown as {
      from: (table: string) => {
        upsert: (data: unknown, options: { onConflict: string }) => {
          select: (columns: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string; code?: string } | null }> }
        }
      }
    }
    const { data: connection, error } = await db.from('integration_connections').upsert({
      organization_id: statePayload.organizationId,
      provider: 'instagram_meta',
      label: profile.username ? `Instagram @${profile.username}` : 'Instagram profissional',
      connection_method: 'oauth',
      external_identifier: profile.id,
      status: 'active',
      encrypted_credentials: encryptToken(accessToken),
      settings: { instagram_username: profile.username || null, auth_method: 'instagram_login' },
    }, { onConflict: 'organization_id,provider,external_identifier' }).select('id').single()

    if (error || !connection) throw new Error(error?.message || 'Não foi possível salvar a conexão.')
    await logAuditEvent({
      organizationId: statePayload.organizationId,
      actorId: statePayload.userId,
      action: 'integration_connection_created',
      targetType: 'integration_connection',
      targetId: connection.id,
      details: { provider: 'instagram_meta', connectionMethod: 'oauth', externalIdentifier: profile.id },
    })
    return redirect(request, 'meta_success', 'Instagram conectado com sucesso.')
  } catch (error) {
    return redirect(request, 'meta_error', error instanceof Error ? error.message : 'Falha ao conectar o Instagram.')
  }
}
