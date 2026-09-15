import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleConversationAnalysis } from '@/lib/ai/insights'

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  dealId: z.string().uuid().optional(),
  // Só enviado quando um pedido acabou de ser marcado Ganho/Perdido de verdade no Funil —
  // nesse caso a IA não precisa (e não deve) adivinhar o desfecho, só explicar o motivo.
  knownOutcome: z.enum(['ganha', 'perdida']).optional(),
})

type TypedSupabase = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: { id: string; organization_id: string } | null }>
      }
    }
  }
}

/**
 * Disparado pelo Funil quando um pedido é movido pra uma etapa Ganha/Perdida (ver
 * moveDeal em funil/page.tsx) — o cliente não tem acesso ao service-role client nem
 * deveria escrever direto em ai_conversation_insights, então isso passa pelo servidor.
 * Sempre responde rápido (a análise roda em segundo plano via after()); "queued: true"
 * não garante que a IA está configurada — sem GEMINI_API_KEY, scheduleConversationAnalysis
 * só não faz nada (ver src/lib/ai/insights.ts).
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  // RLS já restringe isto à organização do próprio usuário — se a conversa não aparecer
  // aqui, ou não existe ou não é desta organização, e os dois casos são "não encontrada".
  const { data: conversation } = await (supabase as unknown as TypedSupabase)
    .from('conversations')
    .select('id, organization_id')
    .eq('id', parsed.data.conversationId)
    .maybeSingle()

  if (!conversation) {
    return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
  }

  const admin = createAdminClient()
  after(() =>
    scheduleConversationAnalysis(admin, {
      conversationId: conversation.id,
      organizationId: conversation.organization_id,
      dealId: parsed.data.dealId ?? null,
      finalize: true,
      knownOutcome: parsed.data.knownOutcome ?? null,
    })
  )

  return NextResponse.json({ queued: true })
}
