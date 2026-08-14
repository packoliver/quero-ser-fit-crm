import { createHmac, timingSafeEqual, randomBytes } from 'crypto'
import { getServerEnv } from '@/lib/env'

export const META_OAUTH_STATE_COOKIE = 'crm_meta_oauth_state'
export const META_OAUTH_STATE_TTL_SECONDS = 10 * 60

interface OAuthStatePayload {
  nonce: string
  userId: string
  organizationId: string
  expiresAt: number
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function stateSignature(value: string): string {
  const secret = getServerEnv().META_APP_SECRET
  if (!secret) throw new Error('META_APP_SECRET não configurado.')
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function createMetaOAuthState(userId: string, organizationId: string): string {
  const payload: OAuthStatePayload = {
    nonce: randomBytes(32).toString('hex'),
    userId,
    organizationId,
    expiresAt: Math.floor(Date.now() / 1000) + META_OAUTH_STATE_TTL_SECONDS,
  }
  const encoded = base64Url(JSON.stringify(payload))
  return `${encoded}.${stateSignature(encoded)}`
}

export function verifyMetaOAuthState(value: string): OAuthStatePayload | null {
  try {
    const [encoded, signature] = value.split('.')
    if (!encoded || !signature) return null
    const expected = stateSignature(encoded)
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthStatePayload
    if (!payload.nonce || !payload.userId || !payload.organizationId || !Number.isInteger(payload.expiresAt)) return null
    if (payload.expiresAt < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function buildMetaInstagramOAuthUrl(state: string): string {
  const env = getServerEnv()
  if (!env.META_APP_ID || !env.META_OAUTH_REDIRECT_URI) {
    throw new Error('META_APP_ID e META_OAUTH_REDIRECT_URI precisam ser configurados.')
  }

  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: env.META_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: env.META_OAUTH_SCOPES || 'instagram_business_basic,instagram_business_manage_messages',
    state,
  })
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`
}

export async function exchangeMetaInstagramCode(code: string): Promise<{ accessToken: string; userId: string }> {
  const env = getServerEnv()
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_OAUTH_REDIRECT_URI) {
    throw new Error('Configuração OAuth da Meta incompleta.')
  }

  const body = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: env.META_OAUTH_REDIRECT_URI,
    code,
  })
  const response = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({})) as { access_token?: string; user_id?: string; error_message?: string }
  if (!response.ok || !result.access_token || !result.user_id) {
    throw new Error(result.error_message || 'A Meta recusou a autorização do Instagram.')
  }
  return { accessToken: result.access_token, userId: String(result.user_id) }
}

export async function fetchInstagramProfile(accessToken: string): Promise<{ id: string; username?: string }> {
  const response = await fetch('https://graph.instagram.com/v25.0/me?fields=user_id,username', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({})) as { user_id?: string; username?: string; error?: { message?: string } }
  if (!response.ok || !result.user_id) throw new Error(result.error?.message || 'Não foi possível identificar a conta do Instagram.')
  return { id: result.user_id, username: result.username }
}
