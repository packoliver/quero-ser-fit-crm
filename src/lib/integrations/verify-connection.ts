import { ZAPAPI_BASE_URL } from './zapapi-whatsapp'
import { getServerEnv } from '@/lib/env'

export interface VerifyResult {
  ok: boolean
  detail: string
  webhookWarning?: string
}

/** Validates a Cloud API token/identifier by asking Meta's Graph API for it directly. */
export async function verifyCloudApiConnection(externalIdentifier: string, accessToken: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(externalIdentifier)}?fields=id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) return { ok: true, detail: '' }
    return { ok: false, detail: body?.error?.message || `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Falha de rede ao validar com a Meta.' }
  }
}

/**
 * Validates a ZAP API instance/token against their own status endpoint, and — if
 * connected — (re-)registers our webhook on that instance so inbound messages start
 * flowing without any manual step on zap-api.tech's side.
 */
export async function verifyZapApiConnection(
  instanceId: string,
  instanceToken: string,
  webhookOrigin: string
): Promise<VerifyResult> {
  let ok = false
  let detail = ''
  try {
    const statusRes = await fetch(`${ZAPAPI_BASE_URL}/instances/${encodeURIComponent(instanceId)}/status`, {
      headers: { Authorization: `Bearer ${instanceToken}` },
    })
    const statusBody = await statusRes.json().catch(() => ({}))
    ok = statusRes.ok && statusBody?.connected === true
    detail = ok ? '' : statusBody?.message || statusBody?.error || `HTTP ${statusRes.status} — instância não conectada ou credenciais inválidas`
  } catch (err) {
    detail = err instanceof Error ? err.message : 'Falha de rede ao validar com a ZAP API.'
  }

  if (!ok) return { ok, detail }

  const env = getServerEnv()
  if (!env.ZAPAPI_WEBHOOK_SECRET) {
    return { ok, detail, webhookWarning: 'Conexão validada, mas ZAPAPI_WEBHOOK_SECRET não está configurada no servidor — o webhook não foi registrado automaticamente.' }
  }

  try {
    const webhookUrl = `${webhookOrigin}/api/webhooks/zapapi`
    const registerRes = await fetch(`${ZAPAPI_BASE_URL}/instances/${encodeURIComponent(instanceId)}/webhook`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${instanceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, events: ['message.received'], secret: env.ZAPAPI_WEBHOOK_SECRET }),
    })
    if (!registerRes.ok) {
      const registerBody = await registerRes.json().catch(() => ({}))
      return {
        ok,
        detail,
        webhookWarning: `Conexão validada, mas falhou ao registrar o webhook automaticamente na ZAP API: ${registerBody?.message || registerBody?.error || `HTTP ${registerRes.status}`}.`,
      }
    }
  } catch (err) {
    return {
      ok,
      detail,
      webhookWarning: `Conexão validada, mas falhou ao registrar o webhook automaticamente: ${err instanceof Error ? err.message : 'erro de rede'}.`,
    }
  }

  return { ok, detail }
}
