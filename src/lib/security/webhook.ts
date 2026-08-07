import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Comparação defensiva em tempo constante para duas strings para prevenir ataques de tempo (timing attacks).
 * Valida a existência dos valores e a igualdade de tamanho dos buffers antes de chamar timingSafeEqual.
 */
export function timingSafeEqualString(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false
  }

  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')

  // Se os tamanhos dos buffers forem diferentes, rejeitar com segurança sem chamar timingSafeEqual
  if (bufA.length !== bufB.length) {
    return false
  }

  return timingSafeEqual(bufA, bufB)
}

/**
 * Validação segura da assinatura HMAC SHA-256 enviada pela Meta no cabeçalho X-Hub-Signature-256.
 * Rejeita assinaturas malformatadas ou ausentes sem causar erro 500.
 */
export function verifyMetaHmacSignature(
  rawBody: string | null | undefined,
  signatureHeader: string | null | undefined,
  appSecret: string | null | undefined
): boolean {
  if (!rawBody || !signatureHeader || !appSecret) {
    return false
  }

  const parts = signatureHeader.split('=')
  if (parts.length !== 2 || parts[0] !== 'sha256' || !parts[1]) {
    return false
  }

  const expectedHex = createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex')

  const expectedHeader = `sha256=${expectedHex}`

  return timingSafeEqualString(expectedHeader, signatureHeader)
}

/**
 * Generic alias for verifyMetaHmacSignature — the sha256=<hex> HMAC scheme isn't
 * Meta-specific, other providers may use the exact same format with a different
 * header name.
 */
export const verifyHmacSha256Signature = verifyMetaHmacSignature
