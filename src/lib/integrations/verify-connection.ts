export interface VerifyResult {
  ok: boolean
  detail: string
  webhookWarning?: string
  /** The provider-side instance/identifier resolved during verification, when applicable. */
  resolvedExternalId?: string
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
 * Validates a uazapi (uazapiGO) instance token against the account's own base URL
 * (each account has its own subdomain, e.g. https://minhaempresa.uazapi.com — there's
 * no single fixed API host like Meta's or zap-api.tech's), then registers our webhook
 * on that instance so inbound messages start flowing automatically.
 *
 * Unlike Meta, uazapi doesn't sign its webhook calls with HMAC — there's no secret
 * field in their webhook config at all. Authenticity is guaranteed instead by a random
 * secret embedded directly in the webhook URL's path (see
 * /api/webhooks/uazapi/[secret]), generated once per connection and reused across
 * re-verifications so the registered URL never needs to change.
 *
 * A device not yet connected (QR Code not scanned) is not treated as a hard failure —
 * the instance/token themselves are valid, so we still register the webhook
 * preemptively; only `ok` reflects whether WhatsApp itself is connected.
 */
export async function verifyUazapiConnection(
  apiBaseUrl: string,
  instanceToken: string,
  webhookOrigin: string,
  webhookSecret: string
): Promise<VerifyResult> {
  const base = apiBaseUrl.replace(/\/$/, '')
  let ok = false
  let detail = ''
  let resolvedExternalId: string | undefined

  try {
    const statusRes = await fetch(`${base}/instance/status`, {
      headers: { token: instanceToken },
    })

    if (statusRes.status === 401 || statusRes.status === 404) {
      const statusBody = await statusRes.json().catch(() => ({}))
      return { ok: false, detail: statusBody?.error || `HTTP ${statusRes.status} — Base URL ou token da instância inválidos.` }
    }

    const statusBody = await statusRes.json().catch(() => ({}))
    resolvedExternalId = statusBody?.instance?.id
    ok = statusRes.ok && statusBody?.status?.connected === true
    detail = ok
      ? ''
      : statusRes.ok
        ? 'Instância acessível, mas o WhatsApp ainda não está conectado — gere o QR Code e escaneie no celular.'
        : statusBody?.error || `HTTP ${statusRes.status}`
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Falha de rede ao validar com a uazapi.' }
  }

  try {
    const webhookUrl = `${webhookOrigin}/api/webhooks/uazapi/${webhookSecret}`
    const registerRes = await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { token: instanceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        events: ['messages', 'connection'],
        excludeMessages: ['wasSentByApi'],
      }),
    })
    if (!registerRes.ok) {
      const registerBody = await registerRes.json().catch(() => ({}))
      return {
        ok,
        detail,
        resolvedExternalId,
        webhookWarning: `${ok ? 'Conexão validada' : 'Instância acessível'}, mas falhou ao registrar o webhook automaticamente na uazapi: ${registerBody?.error || `HTTP ${registerRes.status}`}.`,
      }
    }
  } catch (err) {
    return {
      ok,
      detail,
      resolvedExternalId,
      webhookWarning: `${ok ? 'Conexão validada' : 'Instância acessível'}, mas falhou ao registrar o webhook automaticamente: ${err instanceof Error ? err.message : 'erro de rede'}.`,
    }
  }

  return { ok, detail, resolvedExternalId }
}
