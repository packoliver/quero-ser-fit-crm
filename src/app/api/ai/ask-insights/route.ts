import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { answerQuestionAboutInsights } from '@/lib/ai/insights'

// Padrão da Vercel pode encerrar a função bem antes do timeout de 45s que o cliente de IA
// usa pra essa pergunta (ver QA_TIMEOUT_MS em client.ts) — sem isso, a Vercel mataria a
// função na própria conta dela antes do nosso próprio timeout sequer disparar.
export const maxDuration = 60

const bodySchema = z.object({ question: z.string().trim().min(1, 'Pergunta vazia.').max(500, 'Pergunta muito longa.') })

type TypedSupabase = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: { organization_id: string; role: string } | null }>
      }
    }
  }
}

/**
 * Barra "Pergunte à IA" da tela Insights — responde com base em todas as conversas já
 * analisadas da organização (ver answerQuestionAboutInsights), não nas mensagens brutas.
 * Mesma gate de admin/gerente das outras rotas de IA: essa pergunta pode revelar
 * desempenho por vendedor(a), dado sensível demais pra qualquer atendente disparar.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, { status: 400 })
  }

  const { data: member } = await (supabase as unknown as TypedSupabase)
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!member || (member.role !== 'admin' && member.role !== 'manager')) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }

  const admin = createAdminClient()
  const result = await answerQuestionAboutInsights(admin, member.organization_id, parsed.data.question)

  if (!result.ok) {
    // Mensagem diferente por motivo, de propósito — "IA não configurada" e "gateway não
    // respondeu" pareciam o mesmo erro genérico antes, o que tornava impossível saber, só
    // olhando a tela, qual dos dois estava realmente acontecendo.
    const messages: Record<typeof result.reason, string> = {
      not_configured:
        'OMNIROUTE_BASE_URL não está configurada neste servidor (Vercel) — confirme se foi salva pro ambiente "Production" e se o valor está correto (com /v1 no final).',
      no_data: 'Ainda não existe nenhuma conversa analisada — clique em "Analisar conversas antigas" primeiro.',
      gateway_failed:
        'A variável está configurada, mas o gateway não respondeu a tempo (15s) ou devolveu um erro. Se o seu gateway só roda em localhost, use "npm run insights:ask -- \'sua pergunta\'" no terminal em vez desta barra — a Vercel não alcança seu localhost diretamente, só através de um túnel público.',
    }
    return NextResponse.json({ error: messages[result.reason] }, { status: 502 })
  }

  return NextResponse.json({ answer: result.answer, consideredCount: result.consideredCount })
}
