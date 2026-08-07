import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'

const BUCKET = 'chat-media'

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
    const res = await fetch(params.sourceUrl, {
      headers: params.authHeader ? { Authorization: params.authHeader } : undefined,
    })
    if (!res.ok) {
      console.error(`mirrorMediaToStorage: falha ao baixar mídia de origem (HTTP ${res.status})`)
      return null
    }

    const mimetype = params.mimetypeHint || res.headers.get('content-type') || undefined
    const buffer = Buffer.from(await res.arrayBuffer())
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
