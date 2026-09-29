import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'
import { lookup } from 'dns/promises'
import { isIP } from 'net'

const BUCKET = 'chat-media'

// Proteção contra SSRF: valida protocolo, resolve DNS e bloqueia IPs privados/loopback
// antes de fazer o fetch. URLs de provedores (Meta/uazapi) são legítimas, mas se um
// atacante conseguir injetar uma URL via payload ou metadata, isso impede acesso a
// recursos internos. Retorna null (seguro) em qualquer falha de validação.
async function validateUrlForFetch(urlString: string): Promise<URL | null> {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    console.warn('[media] URL inválida rejeitada:', urlString)
    return null
  }

  // Apenas HTTP/HTTPS — bloqueia file://, gopher://, ftp:// etc.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.warn('[media] Protocolo não permitido rejeitado:', parsed.protocol)
    return null
  }

  const hostname = parsed.hostname
  if (!hostname) {
    console.warn('[media] Hostname vazio rejeitado')
    return null
  }

  // Se já for IP literal, valida diretamente sem resolver DNS
  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      console.warn('[media] IP privado/reservado rejeitado:', hostname)
      return null
    }
    return parsed
  }

  // Resolve DNS e verifica todos os endereços retornados
  try {
    const addresses = await lookup(hostname, { all: true })
    for (const addr of addresses) {
      if (isPrivateOrReservedIp(addr.address)) {
        console.warn('[media] DNS resolveu para IP privado/reservado:', hostname, '->', addr.address)
        return null
      }
    }
  } catch (err) {
    console.warn('[media] Falha ao resolver DNS para', hostname, ':', err instanceof Error ? err.message : String(err))
    return null
  }

  return parsed
}

// Verifica se um IP é privado, loopback, link-local, multicast ou reservado
function isPrivateOrReservedIp(ip: string): boolean {
  // IPv4
  const parts = ip.split('.').map(Number)
  if (parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) {
    // 127.x.x.x — loopback
    if (parts[0] === 127) return true
    // 10.x.x.x — private
    if (parts[0] === 10) return true
    // 172.16-31.x.x — private
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    // 192.168.x.x — private
    if (parts[0] === 192 && parts[1] === 168) return true
    // 169.254.x.x — link-local
    if (parts[0] === 169 && parts[1] === 254) return true
    // 0.x.x.x — current network
    if (parts[0] === 0) return true
    // 224+ — multicast/reserved
    if (parts[0] >= 224) return true
    return false
  }

  // IPv6 — verifica padrões conhecidos
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local
  if (lower.startsWith('fe80')) return true // link-local
  if (lower.startsWith('ff')) return true // multicast
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const mappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedMatch) return isPrivateOrReservedIp(mappedMatch[1])

  return false
}
// Um pouco abaixo do file_size_limit real do bucket (25MB) de propósito — o upload em si
// carrega algum overhead além do tamanho puro do arquivo, então cortar exatamente em 25MB
// aqui podia deixar passar um arquivo que ainda assim estoura o limite no upload real pro
// Storage (mesmo raciocínio do MAX_MEDIA_SIZE_BYTES do lado do navegador, em inbox/page.tsx).
const MAX_MEDIA_SIZE_BYTES = 24 * 1024 * 1024 // 24MB — margem de segurança abaixo do limite de 25MB do bucket

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
}

function guessExtension(mimetype: string | undefined, fallbackUrl: string): string {
  if (mimetype && EXTENSION_BY_MIME[mimetype]) return EXTENSION_BY_MIME[mimetype]
  const fromUrl = fallbackUrl.split('?')[0].split('.').pop()
  if (fromUrl && fromUrl.length <= 5) return fromUrl
  return 'bin'
}

/**
 * Downloads a media file from wherever the provider is hosting it and re-uploads it
 * into our own `chat-media` Storage bucket, returning a permanent, publicly fetchable
 * URL. This exists because provider-hosted URLs aren't reliable long-term:
 * - uazapi's /message/download link expires after 2 days on their side.
 * - Meta's media URLs require a Bearer token to fetch at all and expire in minutes.
 *
 * Returns null (never throws) on any failure — callers should fall back to persisting
 * the message without media rather than losing the whole inbound event over a media
 * mirroring hiccup.
 */
export async function mirrorMediaToStorage(params: {
  sourceUrl: string
  organizationId: string
  /** Omit when not known yet (e.g. inbound media — the conversation is resolved after this runs). */
  conversationId?: string
  authHeader?: string
  mimetypeHint?: string
}): Promise<string | null> {
  try {
    // SSRF protection: validate URL before fetching
    const validatedUrl = await validateUrlForFetch(params.sourceUrl)
    if (!validatedUrl) {
      console.error('mirrorMediaToStorage: URL rejeitada pela proteção SSRF')
      return null
    }

    const res = await fetch(validatedUrl.toString(), {
      headers: params.authHeader ? { Authorization: params.authHeader } : undefined,
    })
    if (!res.ok) {
      console.error(`mirrorMediaToStorage: falha ao baixar mídia de origem (HTTP ${res.status})`)
      return null
    }

    // Corta cedo se o servidor de origem já anuncia um arquivo maior que o limite do
    // bucket, em vez de baixar tudo pra memória da função serverless só pra falhar no
    // upload depois. Sem Content-Length (transfer chunked) não dá pra checar
    // antecipadamente — segue e deixa o limite do bucket rejeitar no upload mesmo.
    const declaredLength = Number(res.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_SIZE_BYTES) {
      console.error(`mirrorMediaToStorage: arquivo de origem maior que o limite (${declaredLength} bytes)`)
      return null
    }

    const mimetype = params.mimetypeHint || res.headers.get('content-type') || undefined
    if (!res.body) {
      console.error('mirrorMediaToStorage: resposta sem corpo de mídia')
      return null
    }

    // Read chunked responses with a hard cap. Checking Content-Length alone is not
    // sufficient because providers may omit it or use transfer-encoding: chunked.
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        totalBytes += value.byteLength
        if (totalBytes > MAX_MEDIA_SIZE_BYTES) {
          await reader.cancel()
          console.error(`mirrorMediaToStorage: arquivo de origem excedeu o limite de ${MAX_MEDIA_SIZE_BYTES} bytes`)
          return null
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes)
    const ext = guessExtension(mimetype, params.sourceUrl)
    const path = `${params.organizationId}/${params.conversationId || 'inbound'}/${Date.now()}-${randomUUID()}.${ext}`

    const admin = createAdminClient()
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buffer, {
      contentType: mimetype,
      upsert: false,
    })
    if (uploadError) {
      console.error('mirrorMediaToStorage: falha no upload pro Storage:', uploadError.message)
      return null
    }

    const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(path)
    return publicUrlData.publicUrl
  } catch (err) {
    console.error('mirrorMediaToStorage: erro inesperado:', err)
    return null
  }
}
