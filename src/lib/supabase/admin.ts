import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getServerEnv } from '@/lib/env'

// Note: intentionally NOT parameterized with the generated `Database` type here.
// The rest of this codebase works around gaps in that generic (see the `as unknown as`
// casts in src/lib/auth.ts and the Equipe page) rather than fighting it — the admin
// client follows the same convention at its call sites.

/**
 * Privileged Supabase client using the Service Role key. Bypasses Row Level Security.
 *
 * NEVER import this from client components or expose it to the browser. Only use it
 * from server-only code (API routes / Server Actions) that has already verified the
 * caller's authorization through the regular (RLS-respecting) server client.
 */
export function createAdminClient() {
  const env = getServerEnv()

  if (!env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL não está configurada.')
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY não está configurada. Operações administrativas (ex.: cadastrar membros da equipe) exigem essa variável de ambiente no servidor.'
    )
  }

  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
