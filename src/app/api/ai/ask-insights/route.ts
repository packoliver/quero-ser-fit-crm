import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { answerQuestionAboutInsights } from '@/lib/ai/insights'

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

  if (!result) {
    return NextResponse.json(
      {
        error:
          'Não foi possível responder por aqui. Se o seu gateway de IA só roda em localhost (ver npm run insights:local), esta barra não alcança ele — use "npm run insights:ask -- \'sua pergunta\'" no terminal em vez disso. Se o gateway é público, confirme se OMNIROUTE_BASE_URL está configurado na Vercel e se já existe alguma conversa analisada.',
      },
      { status: 502 }
    )
  }

  return NextResponse.json(result)
}
