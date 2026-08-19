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

/**
 * O produto "Instagram API com login do Instagram" tem app ID e chave secreta próprios,
 * exibidos em Instagram → Configuração da API com login do Instagram — diferentes do
 * app ID/segredo da Meta que aparecem no topo do painel. O Business Login e a troca do
 * code por token só aceitam as credenciais do Instagram; usar as da Meta devolve
 * "Error validating verification code" mesmo com o redirect_uri correto.
 *
 * Mantemos o fallback pras variáveis META_* pra não quebrar quem já tinha configurado
 * um app onde os dois valores coincidem, mas o correto é definir INSTAGRAM_APP_ID e
 * INSTAGRAM_APP_SECRET.
 */
function getInstagramAppCredentials(): { appId?: string; appSecret?: string } {
  const env = getServerEnv()
  return {
    appId: env.INSTAGRAM_APP_ID || env.META_APP_ID,
    appSecret: env.INSTAGRAM_APP_SECRET || env.META_APP_SECRET,
  }
}

function stateSignature(value: string): string {
  const env = getServerEnv()
  // Segredo interno só pra assinar o state do OAuth: qualquer um dos dois serve, desde
  // que seja o mesmo na criação e na verificação (mesmo processo, mesma ordem).
  const secret = env.META_APP_SECRET || env.INSTAGRAM_APP_SECRET
  if (!secret) throw new Error('META_APP_SECRET ou INSTAGRAM_APP_SECRET precisa estar configurado.')
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
  const { appId } = getInstagramAppCredentials()
  if (!appId || !env.META_OAUTH_REDIRECT_URI) {
    throw new Error('INSTAGRAM_APP_ID e META_OAUTH_REDIRECT_URI precisam ser configurados.')
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: env.META_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: env.META_OAUTH_SCOPES || 'instagram_business_basic,instagram_business_manage_messages',
    state,
  })
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`
}

export async function exchangeMetaInstagramCode(code: string): Promise<{ accessToken: string; userId: string }> {
  const env = getServerEnv()
  const { appId, appSecret } = getInstagramAppCredentials()
  if (!appId || !appSecret || !env.META_OAUTH_REDIRECT_URI) {
    throw new Error('Configuração OAuth do Instagram incompleta.')
  }

  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
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

/**
 * Troca o token de curta duração (válido ~1h, o único que `exchangeMetaInstagramCode`
 * devolve) por um de longa duração (~60 dias). Sem esse segundo passo a conexão
 * funciona só na primeira hora — toda reverificação depois disso falha com um erro
 * genérico da Meta, porque o token de 1h já expirou silenciosamente.
 */
export async function exchangeForLongLivedInstagramToken(shortLivedToken: string): Promise<string> {
  const { appSecret } = getInstagramAppCredentials()
  if (!appSecret) {
    throw new Error('INSTAGRAM_APP_SECRET não configurado.')
  }

  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: appSecret,
    access_token: shortLivedToken,
  })
  const response = await fetch(`https://graph.instagram.com/access_token?${params.toString()}`, {
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } }
  if (!response.ok || !result.access_token) {
    // Não deve travar a conexão inteira: o token de curta duração ainda é válido agora,
    // então quem chama pode optar por seguir com ele e deixar a próxima reverificação
    // pegar o problema, em vez de perder a conexão por completo.
    throw new Error(result.error?.message || 'Não foi possível estender a validade do token do Instagram.')
  }
  return result.access_token
}

/**
 * Assina a conta recém-conectada nos webhooks de mensagens.
 *
 * Assinar o campo `messages` no painel do app não basta: a assinatura do painel só diz
 * quais campos o APP quer receber. Cada conta profissional ainda precisa ser inscrita
 * individualmente, e é isso que este POST faz — sem ele o webhook nunca dispara pra essa
 * conta e o Direct simplesmente não chega, sem nenhum erro visível em lugar nenhum.
 *
 * Feito automaticamente no fim do OAuth pra não depender de ninguém lembrar de adicionar
 * a conta manualmente em "Gerar tokens de acesso" no painel da Meta.
 */
export async function subscribeInstagramWebhooks(accessToken: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    // 'message_echoes' NÃO é um campo válido nessa API (Instagram API with Instagram
    // Login, graph.instagram.com) — tentativa real retornou "must be one of {...} - got
    // 'message_echoes'" (a Meta nem lista essa opção pra essa API). Não precisa mesmo:
    // cópias de mensagens que a própria conta mandou (pelo CRM ou pelo app oficial) já
    // chegam pelo campo `messages` normal, marcadas com is_echo/is_self no payload — é
    // por isso que o parser (instagram-meta.ts) sempre teve um filtro pra elas, mesmo
    // sem nenhuma inscrição especial.
    const params = new URLSearchParams({ subscribed_fields: 'messages' })
    const response = await fetch(`https://graph.instagram.com/v25.0/me/subscribed_apps?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    const result = await response.json().catch(() => ({})) as { success?: boolean; error?: { message?: string } }
    if (!response.ok || result.success === false) {
      return { ok: false, detail: result.error?.message || `HTTP ${response.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'erro de rede' }
  }
}

/**
 * Busca `id` E `user_id` de propósito. A Meta expõe dois identificadores pra mesma conta
 * (o app-scoped `id` e o `user_id` da conta profissional) e a documentação não deixa
 * claro qual deles aparece como `recipient.id` nos webhooks de mensagem. Se guardarmos
 * só um e a Meta mandar o outro, nenhuma conexão casa e a mensagem é descartada em
 * silêncio — sem erro em log nenhum, que é o pior modo de falhar. Guardamos os dois e
 * aceitamos qualquer um na hora de casar o webhook.
 */
export async function fetchInstagramProfile(
  accessToken: string
): Promise<{ id: string; appScopedId?: string; username?: string }> {
  const response = await fetch('https://graph.instagram.com/v25.0/me?fields=id,user_id,username', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({})) as {
    id?: string
    user_id?: string
    username?: string
    error?: { message?: string }
  }
  const primaryId = result.user_id || result.id
  if (!response.ok || !primaryId) {
    throw new Error(result.error?.message || 'Não foi possível identificar a conta do Instagram.')
  }
  return {
    id: primaryId,
    appScopedId: result.id && result.id !== primaryId ? result.id : undefined,
    username: result.username,
  }
}
