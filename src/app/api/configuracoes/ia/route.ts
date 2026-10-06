import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthenticatedUserContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptToken, decryptToken } from '@/lib/security/encryption'

const aiConfigSchema = z.object({
  ai_gateway_url: z.string().trim().max(2048).refine((value) => {
    if (!value) return true
    try {
      return ['https:', 'http:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }, 'URL do gateway inválida. Use uma URL completa com http ou https.').nullable().optional(),
  ai_gateway_api_key: z.string().trim().max(8192).nullable().optional(),
  ai_gateway_model: z.string().trim().max(200).nullable().optional(),
})

async function requireAdminOrganization() {
  const auth = await getAuthenticatedUserContext()
  if (!auth.authenticated || !auth.userId) {
    return { error: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) } as const
  }
  if (auth.role !== 'admin' || !auth.organizationId) {
    return { error: NextResponse.json({ error: 'Apenas administradores podem configurar a IA.' }, { status: 403 }) } as const
  }
  return { organizationId: auth.organizationId } as const
}

// GET /api/configuracoes/ia — lê as configurações de IA da organização do usuário autenticado.
// A API key é retornada mascarada (ex: "sk-***abc") pra nunca expor o valor real no frontend.
export async function GET() {
  try {
    const auth = await requireAdminOrganization()
    if ('error' in auth) return auth.error
    const supabase = createAdminClient()

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, ai_gateway_url, ai_gateway_api_key_encrypted, ai_gateway_model')
      .eq('id', auth.organizationId)
      .maybeSingle()

    if (orgError) {
      console.error('[ai-config] Erro ao buscar organização:', orgError)
      return NextResponse.json({ error: 'Falha ao carregar configurações.' }, { status: 500 })
    }

    if (!org) {
      return NextResponse.json({ configured: false })
    }

    let apiKeyMasked: string | null = null
    if (org.ai_gateway_api_key_encrypted) {
      try {
        const decrypted = decryptToken(org.ai_gateway_api_key_encrypted)
        apiKeyMasked = decrypted.length > 6
          ? `${decrypted.slice(0, 3)}***${decrypted.slice(-3)}`
          : '***'
      } catch {
        apiKeyMasked = '[ERRO DE CRIPTOGRAFIA]'
      }
    }

    return NextResponse.json({
      configured: !!org.ai_gateway_url,
      ai_gateway_url: org.ai_gateway_url,
      ai_gateway_model: org.ai_gateway_model,
      ai_gateway_api_key_masked: apiKeyMasked,
      has_api_key: !!org.ai_gateway_api_key_encrypted,
    })
  } catch (err) {
    console.error('[ai-config] Erro inesperado:', err)
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}

// POST /api/configuracoes/ia — salva URL, modelo e opcionalmente a API key.
// Se api_key for string vazia ou não enviada, mantém a chave existente inalterada.
// Se api_key for explicitamente null, remove a chave armazenada.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminOrganization()
    if ('error' in auth) return auth.error

    const body: unknown = await request.json().catch(() => null)
    const parsed = aiConfigSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, { status: 400 })
    }
    const { ai_gateway_url, ai_gateway_api_key, ai_gateway_model } = parsed.data

    const supabase = createAdminClient()

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', auth.organizationId)
      .maybeSingle()

    if (orgError) {
      return NextResponse.json({ error: 'Falha ao carregar organização.' }, { status: 500 })
    }
    if (!org) {
      return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 })
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (ai_gateway_url !== undefined) {
      updatePayload.ai_gateway_url = ai_gateway_url?.trim() || null
    }

    if (ai_gateway_model !== undefined) {
      updatePayload.ai_gateway_model = ai_gateway_model?.trim() || null
    }

    // Lógica da API key:
    // - string não-vazia → criptografa e salva
    // - null explícito → remove (seta NULL)
    // - undefined / omitido → não altera
    if (ai_gateway_api_key !== undefined) {
      if (ai_gateway_api_key === null) {
        updatePayload.ai_gateway_api_key_encrypted = null
      } else if (ai_gateway_api_key) {
        updatePayload.ai_gateway_api_key_encrypted = encryptToken(ai_gateway_api_key.trim())
      }
    }

    const { error: updateError } = await supabase
      .from('organizations')
      .update(updatePayload)
      .eq('id', auth.organizationId)

    if (updateError) {
      console.error('[ai-config] Erro ao salvar:', updateError)
      return NextResponse.json({ error: 'Falha ao salvar configurações.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[ai-config] Erro inesperado:', err)
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}
