import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthenticatedUserContext } from '@/lib/auth'
import {
  buildMetaInstagramOAuthUrl,
  createMetaOAuthState,
  META_OAUTH_STATE_COOKIE,
  META_OAUTH_STATE_TTL_SECONDS,
} from '@/lib/integrations/meta-oauth'

export async function GET(request: Request) {
  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated || !auth.userId || !auth.organizationId) {
    return NextResponse.json({ error: auth.error || 'Não autenticado.' }, { status: 401 })
  }
  if (auth.role !== 'admin' && auth.role !== 'manager') {
    return NextResponse.json({ error: 'Apenas administradores podem conectar o Instagram.' }, { status: 403 })
  }

  try {
    const state = createMetaOAuthState(auth.userId, auth.organizationId)
    const cookieStore = await cookies()
    cookieStore.set(META_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/integrations/meta/oauth',
      maxAge: META_OAUTH_STATE_TTL_SECONDS,
    })
    return NextResponse.redirect(buildMetaInstagramOAuthUrl(state))
  } catch (error) {
    return NextResponse.redirect(new URL(`/configuracoes/integracoes?meta_error=${encodeURIComponent(error instanceof Error ? error.message : 'Configuração OAuth incompleta.')}`, request.url))
  }
}
