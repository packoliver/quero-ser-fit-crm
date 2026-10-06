import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { answerQuestionAboutInsights, saveQaHistory } from '@/lib/ai/insights'
import { withRateLimit } from '@/lib/security/rate-limit-middleware'

// Inclui margem para buscas no banco e o limite de 115s da resposta completa do gateway.
export const maxDuration = 150

// 500 chars era curto demais pra um pedido de relatório detalhado (ex: "analise todas as
// conversas do período e identifique X, Y, Z... quero um relatório objetivo com...") — o
// contexto que já vai no prompt (até 2000 conversas resumidas) é MUITO maior que isso, uma
// pergunta de algumas frases não pesa nada perto disso.
const bodySchema = z.object({ question: z.string().trim().min(1, 'Pergunta vazia.').max(4000, 'Pergunta muito longa (máximo 4000 caracteres).'),
  periodDays: z.number().int().min(1).max(365).nullable().optional() })

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
export const POST = withRateLimit('ai', async (request: NextRequest) => {
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
  const result = await answerQuestionAboutInsights(admin, member.organization_id, parsed.data.question, parsed.data.periodDays ?? null)

  if (!result.ok) {
    // Mensagem diferente por motivo, de propósito — "IA não configurada" e "gateway não
    // respondeu" pareciam o mesmo erro genérico antes, o que tornava impossível saber, só
    // olhando a tela, qual dos dois estava realmente acontecendo.
    const messages: Record<typeof result.reason, string> = {
      not_configured:
        'Gateway de IA não configurado — acesse Configurações → IA (Insights) no painel admin para configurar a URL e chave do gateway.',
      no_data: 'Não há conversas já analisadas no período solicitado. Tente outro período ou analise as conversas antigas primeiro.',
      gateway_failed:
        'O gateway de IA não concluiu a resposta em até 115 segundos ou devolveu um erro. Tente uma pergunta mais específica ou um período menor. Se persistir, confira os registros do OmniRoute.',
    }
    return NextResponse.json({ error: messages[result.reason] }, { status: 502 })
  }

  await saveQaHistory(admin, {
    organizationId: member.organization_id,
    askedBy: user.id,
    question: parsed.data.question,
    answer: result.answer,
    consideredCount: result.consideredCount,
  })

  return NextResponse.json({ answer: result.answer, consideredCount: result.consideredCount, periodDays: result.periodDays })
  })
