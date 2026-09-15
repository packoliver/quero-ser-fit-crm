import { z } from 'zod'

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL deve ser uma URL válida').optional().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().or(z.literal('')),
  NEXT_PUBLIC_ENABLE_DEMO_MODE: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal('')),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  // "Instagram API com login do Instagram" é um app próprio dentro do app da Meta, com
  // ID e chave secreta SEPARADOS (painel: Instagram → Configuração da API com login do
  // Instagram). O Business Login e a assinatura dos webhooks do Instagram usam essas
  // credenciais — usar as da Meta faz o OAuth falhar na troca do code e os webhooks
  // chegarem com assinatura inválida (401).
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  META_OAUTH_REDIRECT_URI: z.string().url().optional(),
  META_OAUTH_SCOPES: z.string().optional(),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().url().optional(),
  // IA (Insights) — opcional de propósito: sem OMNIROUTE_BASE_URL, a análise de conversas
  // por IA só fica desligada (ver src/lib/ai/client.ts), o resto do CRM funciona normal.
  // Fala o formato compatível com OpenAI (POST {base}/chat/completions) — pensado pra um
  // gateway tipo OmniRoute (https://www.omniroute.online) auto-hospedado pelo usuário, mas
  // funciona com qualquer serviço compatível com a mesma API. OMNIROUTE_MODEL deixa trocar
  // de modelo/rota (custo/qualidade) sem precisar de deploy — ver default em client.ts.
  OMNIROUTE_BASE_URL: z.string().url('OMNIROUTE_BASE_URL deve ser uma URL válida (ex: https://seu-dominio.com/v1)').optional(),
  OMNIROUTE_API_KEY: z.string().optional(),
  OMNIROUTE_MODEL: z.string().optional(),
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
    META_APP_ID: process.env.META_APP_ID || undefined,
    META_APP_SECRET: process.env.META_APP_SECRET || undefined,
    INSTAGRAM_APP_ID: process.env.INSTAGRAM_APP_ID || undefined,
    INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET || undefined,
    META_OAUTH_REDIRECT_URI: process.env.META_OAUTH_REDIRECT_URI || undefined,
    META_OAUTH_SCOPES: process.env.META_OAUTH_SCOPES || undefined,
    // Em produção, uma chave ausente OU igual ao fallback conhecido de dev é tratada
    // como "não configurada" (undefined), forçando getEncryptionKey() a lançar erro
    // em vez de criptografar silenciosamente com uma chave pública e comprometida.
    INTEGRATION_ENCRYPTION_KEY: isProduction ? (isUnsafeKey ? undefined : envKey) : (envKey || KNOWN_FALLBACK_KEY),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || undefined,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || undefined,
    OMNIROUTE_BASE_URL: process.env.OMNIROUTE_BASE_URL || undefined,
    OMNIROUTE_API_KEY: process.env.OMNIROUTE_API_KEY || undefined,
    OMNIROUTE_MODEL: process.env.OMNIROUTE_MODEL || undefined,
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
