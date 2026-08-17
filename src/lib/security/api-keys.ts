import { randomBytes, createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { AdminClient } from '@/lib/supabase/admin'

const KEY_PREFIX = 'crm_'

/** SHA-256 é suficiente aqui (não é senha de usuário — é um segredo aleatório de alta
 * entropia, sem necessidade de bcrypt/argon2 pra se defender de força bruta offline). */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

/** Gera uma chave nova. `plaintext` só existe aqui — quem chama deve devolvê-la pro
 * usuário na resposta e nunca mais consegue recuperá-la depois (só o hash fica salvo). */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`
  return { plaintext, hash: hashApiKey(plaintext), prefix: plaintext.slice(0, 12) }
}

export interface ApiKeyAuth {
  organizationId: string
  keyId: string
}

/**
 * Autentica uma requisição da API pública via `Authorization: Bearer <chave>`. Retorna
 * null (sem lançar) pra qualquer chave ausente, inválida ou revogada — quem chama decide
 * o status HTTP. Atualiza `last_used_at` em melhor esforço (não bloqueia a resposta).
 */
export async function authenticateApiKey(request: NextRequest, admin: AdminClient): Promise<ApiKeyAuth | null> {
  const header = request.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return null

  const db = admin as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> }
      }
      update: (vals: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<{ error: unknown }> }
    }
  }

  const { data } = await db
    .from('api_keys')
    .select('id, organization_id, revoked_at')
    .eq('key_hash', hashApiKey(token))
    .maybeSingle()

  const row = data as { id: string; organization_id: string; revoked_at: string | null } | null
  if (!row || row.revoked_at) return null

  db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).catch(() => {})

  return { organizationId: row.organization_id, keyId: row.id }
}
