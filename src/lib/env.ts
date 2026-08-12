import { z } from 'zod'

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL deve ser uma URL válida').optional().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().or(z.literal('')),
  NEXT_PUBLIC_ENABLE_DEMO_MODE: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal('')),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().url().optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cachedEnv: ServerEnv | null = null

export function getServerEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv

  const isProduction = process.env.NODE_ENV === 'production'
  const envKey = process.env.INTEGRATION_ENCRYPTION_KEY
  const KNOWN_FALLBACK_KEY = '12345678901234567890123456789012'
  const isUnsafeKey = !envKey || envKey === KNOWN_FALLBACK_KEY

  if (isProduction && isUnsafeKey) {
    console.error(
      '[CRÍTICO] SEGURANÇA DE PRODUÇÃO: A variável INTEGRATION_ENCRYPTION_KEY é obrigatória em ambiente de produção e não pode usar o valor padrão de desenvolvimento!'
    )
  }

  const rawEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    NEXT_PUBLIC_ENABLE_DEMO_MODE: process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE || 'false',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN || undefined,
    META_APP_SECRET: process.env.META_APP_SECRET || undefined,
    // Em produção, uma chave ausente OU igual ao fallback conhecido de dev é tratada
    // como "não configurada" (undefined), forçando getEncryptionKey() a lançar erro
    // em vez de criptografar silenciosamente com uma chave pública e comprometida.
    INTEGRATION_ENCRYPTION_KEY: isProduction ? (isUnsafeKey ? undefined : envKey) : (envKey || KNOWN_FALLBACK_KEY),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || undefined,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || undefined,
  }

  const result = serverEnvSchema.safeParse(rawEnv)

  if (!result.success) {
    const missingKeys = result.error.issues.map((issue) => issue.path.join('.')).join(', ')
    console.error(`[AVISO DE AMBIENTE] Variáveis de ambiente incompletas: ${missingKeys}`)
  }

  cachedEnv = result.data || rawEnv
  return cachedEnv
}

/**
 * Função utilitária para mascarar segredos nos logs sem expor o valor real.
 */
export function sanitizeSecret(secret?: string | null): string {
  if (!secret) return '[NÃO CONFIGURADO]'
  if (secret.length <= 6) return '***'
  return `${secret.slice(0, 3)}***${secret.slice(-3)}`
}
