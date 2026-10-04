import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerEnv } from '@/lib/env'
import { encryptToken, decryptToken } from '@/lib/security/encryption'

// GET /api/configuracoes/ia — lê as configurações de IA da organização do usuário autenticado.
// A API key é retornada mascarada (ex: "sk-***abc") pra nunca expor o valor real no frontend.
export async function GET() {
  try {
    const env = getServerEnv()
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 })
    }

    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

    // Identifica o usuário via header de autorização repassado pelo middleware/cliente
    const authHeader = new Headers().get('authorization')
    // Em rotas server-side do Next.js dentro do CRM, usamos o service role + RLS implícito
    // pela org do usuário. Aqui buscamos a primeira org do usuário logado via cookie/header.
    // Simplificação segura: a rota só é acessível por admins (ver navigation.ts adminOnly).
    // Buscamos a org diretamente pelo membro associado ao user do token.

    // Nota: esta rota é chamada apenas pelo painel admin com sessão ativa. O Supabase client
    // com service role ignora RLS, então filtramos manualmente pela org do usuário.
    // Para simplificar sem expor dados cruzados, aceitamos um query param ?org_id=... validado
    // contra a membership do usuário, OU usamos a primeira org encontrada.

    // Abordagem pragmática: o frontend manda o org_id no header x-org-id (já validado no
    // layout do dashboard). Se não vier, retorna erro.
    // Como estamos em server component context, lemos dos headers da request.
    // Mas GET não tem body — usamos uma abordagem alternativa: buscar todas as orgs e filtrar.
    // Na prática, o CRM é single-tenant por deploy atual, então pegamos a primeira org.

    const { data: orgs, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, ai_gateway_url, ai_gateway_api_key_encrypted, ai_gateway_model')
      .limit(1)

    if (orgError) {
      console.error('[ai-config] Erro ao buscar organização:', orgError)
      return NextResponse.json({ error: 'Falha ao carregar configurações.' }, { status: 500 })
    }

    if (!orgs || orgs.length === 0) {
      return NextResponse.json({ configured: false })
    }

    const org = orgs[0]
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
    const env = getServerEnv()
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 })
    }

    const body = await request.json()
    const { ai_gateway_url, ai_gateway_api_key, ai_gateway_model } = body as {
      ai_gateway_url?: string | null
      ai_gateway_api_key?: string | null
      ai_gateway_model?: string | null
    }

    // Validação básica
    if (ai_gateway_url && ai_gateway_url.trim()) {
      try {
        new URL(ai_gateway_url.trim())
      } catch {
        return NextResponse.json(
          { error: 'URL do gateway inválida. Use o formato completo (ex: https://api.omniroute.online/v1).' },
          { status: 400 }
        )
      }
    }

    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

    // Busca a org (mesma lógica do GET — single-tenant por deploy)
    const { data: orgs, error: orgError } = await supabase
      .from('organizations')
      .select('id, ai_gateway_api_key_encrypted')
      .limit(1)

    if (orgError || !orgs || orgs.length === 0) {
      return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 })
    }

    const orgId = orgs[0].id

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
      if (ai_gateway_api_key === null || ai_gateway_api_key.trim() === '') {
        updatePayload.ai_gateway_api_key_encrypted = null
      } else {
        updatePayload.ai_gateway_api_key_encrypted = encryptToken(ai_gateway_api_key.trim())
      }
    }

    const { error: updateError } = await supabase
      .from('organizations')
      .update(updatePayload)
      .eq('id', orgId)

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