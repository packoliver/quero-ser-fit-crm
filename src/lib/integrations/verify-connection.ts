export interface VerifyResult {
  ok: boolean
  detail: string
  webhookWarning?: string
  /** The provider-side instance/identifier resolved during verification, when applicable. */
  resolvedExternalId?: string
}

/**
 * Validates a Cloud API token/identifier by asking Meta's Graph API for it directly.
 *
 * WhatsApp Cloud API tokens are validated against graph.facebook.com. Instagram Direct
 * tokens are issued through Instagram Login (graph.instagram.com) and are scoped to that
 * host — presenting one to graph.facebook.com fails with "Invalid OAuth access token -
 * Cannot parse access token" even though the token itself is fine, so Instagram must be
 * verified against graph.instagram.com instead.
 */
export async function verifyCloudApiConnection(
  externalIdentifier: string,
  accessToken: string,
  provider: 'whatsapp_cloud_api' | 'instagram_meta' = 'whatsapp_cloud_api'
): Promise<VerifyResult> {
  const host = provider === 'instagram_meta' ? 'graph.instagram.com' : 'graph.facebook.com'
  const apiVersion = provider === 'instagram_meta' ? 'v25.0' : 'v20.0'
  try {
    const res = await fetch(`https://${host}/${apiVersion}/${encodeURIComponent(externalIdentifier)}?fields=id`, {
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
 * Registers our webhook on a uazapi instance — "modo simples" (no id/action in the
 * body) means this always overwrites whatever's currently configured, which is exactly
 * what we want: it's the one thing that reliably undoes drift if someone edits the
 * Webhooks screen on uazapi's own dashboard by hand and re-saves stale form state
 * (addUrlEvents/addUrlTypesMessages toggled on, an old secret in the URL — this has
 * happened for real, more than once). Called both from verifyUazapiConnection below and
 * directly from the QR-connect polling route the moment a device finishes connecting,
 * as a second reinforcement point beyond just creation/reverify.
 */
export async function registerUazapiWebhook(
  apiBaseUrl: string,
  instanceToken: string,
  webhookOrigin: string,
  webhookSecret: string
): Promise<{ ok: boolean; warning?: string }> {
  try {
    const base = apiBaseUrl.replace(/\/$/, '')
    const webhookUrl = `${webhookOrigin}/api/webhooks/uazapi/${webhookSecret}`
    const registerRes = await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { token: instanceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        events: ['messages', 'messages_update', 'connection'],
        excludeMessages: ['wasSentByApi'],
        addUrlEvents: false,
        addUrlTypesMessages: false,
      }),
    })
    if (!registerRes.ok) {
      const registerBody = await registerRes.json().catch(() => ({}))
      return { ok: false, warning: `Falhou ao registrar o webhook automaticamente na uazapi: ${registerBody?.error || `HTTP ${registerRes.status}`}.` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, warning: `Falhou ao registrar o webhook automaticamente: ${err instanceof Error ? err.message : 'erro de rede'}.` }
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

  const registration = await registerUazapiWebhook(apiBaseUrl, instanceToken, webhookOrigin, webhookSecret)
  if (!registration.ok) {
    return {
      ok,
      detail,
      resolvedExternalId,
      webhookWarning: `${ok ? 'Conexão validada, mas' : 'Instância acessível, mas'} ${registration.warning}`,
    }
  }

  return { ok, detail, resolvedExternalId }
}
