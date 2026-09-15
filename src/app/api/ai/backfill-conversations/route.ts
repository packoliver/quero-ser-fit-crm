import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleConversationAnalysis } from '@/lib/ai/insights'

// Poucas conversas por chamada, de propósito: cada uma pode levar até TIMEOUT_MS (ver
// src/lib/ai/gemini.ts) pra responder, e isto roda DENTRO do tempo de resposta da rota
// (sem after() — ao contrário dos outros gatilhos, aqui o cliente espera o resultado pra
// mostrar progresso). A tela de Insights chama isto em loop até `done: true`.
const BATCH_SIZE = 3
export const maxDuration = 60

const bodySchema = z.object({ cursor: z.string().datetime().nullable().optional() })

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
 * Preenche o histórico: analisa conversas que já existiam ANTES da feature Insights
 * entrar no ar (o monitoramento normal só reage a mensagem nova a partir de agora — ver
 * hooks em persist-event.ts / messages/send/route.ts). Idempotente e retomável: só olha
 * conversas que ainda não têm nenhuma linha em ai_conversation_insights, então rodar de
 * novo (ex.: a pessoa fechou a aba no meio) simplesmente continua de onde parou, sem
 * reprocessar nem duplicar chamada à IA.
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  const { data: member } = await (supabase as unknown as TypedSupabase)
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  // Mesmo recorte de quem PODE ver a tela de Insights (ver RLS de ai_conversation_insights
  // e adminOnly em navigation.ts) — não faz sentido deixar um attendant disparar gasto de
  // IA pra uma tela que ele nem consegue abrir depois.
  if (!member || (member.role !== 'admin' && member.role !== 'manager')) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }

  const admin = createAdminClient()
  const organizationId = member.organization_id

  let query = admin.from('conversations').select('id, last_message_at').eq('organization_id', organizationId)
  if (parsed.data.cursor) {
    query = query.lt('last_message_at', parsed.data.cursor)
  }

  const { data: batch } = await query.order('last_message_at', { ascending: false }).limit(BATCH_SIZE)
  const conversations = (batch || []) as { id: string; last_message_at: string }[]

  if (conversations.length === 0) {
    return NextResponse.json({ done: true, examined: 0, analyzed: 0, nextCursor: null })
  }

  const conversationIds = conversations.map((c) => c.id)

  const [{ data: existingInsights }, { data: deals }, { data: stages }] = await Promise.all([
    admin.from('ai_conversation_insights').select('conversation_id').in('conversation_id', conversationIds),
    admin.from('deals').select('id, stage, conversation_id').in('conversation_id', conversationIds),
    admin.from('pipeline_stages').select('key, is_won, is_lost').eq('organization_id', organizationId),
  ])

  const alreadyAnalyzed = new Set(((existingInsights || []) as { conversation_id: string }[]).map((r) => r.conversation_id))
  const dealByConversation = new Map(
    ((deals || []) as { id: string; stage: string; conversation_id: string }[]).map((d) => [d.conversation_id, d])
  )
  const stageByKey = new Map(((stages || []) as { key: string; is_won: boolean; is_lost: boolean }[]).map((s) => [s.key, s]))

  let analyzed = 0
  for (const conv of conversations) {
    if (alreadyAnalyzed.has(conv.id)) continue

    const deal = dealByConversation.get(conv.id)
    const stage = deal ? stageByKey.get(deal.stage) : undefined
    const knownOutcome: 'ganha' | 'perdida' | null = stage?.is_won ? 'ganha' : stage?.is_lost ? 'perdida' : null

    // Sem after() aqui — diferente dos gatilhos em tempo real, esta rota EXISTE pra
    // esperar o resultado e devolver progresso pro botão "Analisar conversas antigas".
    await scheduleConversationAnalysis(admin, {
      conversationId: conv.id,
      organizationId,
      dealId: deal?.id ?? null,
      finalize: !!knownOutcome,
      knownOutcome,
    })
    analyzed++
  }

  const lastExamined = conversations[conversations.length - 1]
  return NextResponse.json({
    done: conversations.length < BATCH_SIZE,
    examined: conversations.length,
    analyzed,
    nextCursor: lastExamined.last_message_at,
  })
}
