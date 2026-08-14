import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthenticatedUserContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptToken } from '@/lib/security/encryption'
import {
  exchangeForLongLivedInstagramToken,
  exchangeMetaInstagramCode,
  fetchInstagramProfile,
  META_OAUTH_STATE_COOKIE,
  subscribeInstagramWebhooks,
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
    const { accessToken: shortLivedToken, userId } = await exchangeMetaInstagramCode(code)
    // `userId` returned by Instagram is the external Instagram account ID, not
    // the CRM auth user ID stored in the signed state. The profile lookup below
    // is the source of truth for the connection identifier.
    void userId

    // Sem isso a conexão fica válida só ~1h (a duração do token que exchangeMetaInstagramCode
    // devolve) e toda verificação depois disso falha silenciosamente. Se a extensão falhar,
    // seguimos com o token curto mesmo assim — a conexão fica ativa por agora, e o erro real
    // aparece na próxima reverificação em vez de bloquear a conexão inicial.
    let accessToken = shortLivedToken
    try {
      accessToken = await exchangeForLongLivedInstagramToken(shortLivedToken)
    } catch {
      // segue com o token de curta duração
    }

    const profile = await fetchInstagramProfile(accessToken)

    // Inscreve esta conta nos webhooks de mensagens. Sem isso a assinatura feita no
    // painel do app não basta e nenhum Direct chega — falha silenciosa, sem erro visível.
    const subscription = await subscribeInstagramWebhooks(accessToken)

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
      settings: {
        instagram_username: profile.username || null,
        auth_method: 'instagram_login',
        ...(subscription.ok ? {} : { webhook_subscription_error: subscription.detail || 'desconhecido' }),
      },
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
    return redirect(
      request,
      'meta_success',
      subscription.ok
        ? 'Instagram conectado com sucesso.'
        : `Instagram conectado, mas a inscrição automática nos webhooks falhou (${subscription.detail}). As mensagens podem não chegar até isso ser resolvido.`
    )
  } catch (error) {
    return redirect(request, 'meta_error', error instanceof Error ? error.message : 'Falha ao conectar o Instagram.')
  }
}
