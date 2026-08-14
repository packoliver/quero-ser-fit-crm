import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const endpointSchema = z.string().url().refine((value) => value.startsWith('https://'), 'Endpoint deve usar HTTPS.').max(2048)
const schema = z.object({ endpoint: endpointSchema, keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }), userAgent: z.string().max(1024).optional() })
const deleteSchema = z.object({ endpoint: endpointSchema })

async function getContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  const { data: membership } = await (supabase as unknown as { from: (table: 'organization_members') => { select: (columns: string) => { eq: (column: string, value: string) => { limit: (count: number) => { maybeSingle: () => Promise<{ data: { organization_id: string } | null }> } } } } }).from('organization_members').select('organization_id').eq('user_id', user.id).limit(1).maybeSingle()
  return membership ? { user, organizationId: membership.organization_id } : null
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const context = await getContext(supabase)
  if (!context) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Subscription inválida.' }, { status: 400 })
  const db = supabase as unknown as {
    from: (table: 'push_subscriptions') => {
      upsert: (value: { organization_id: string; user_id: string; endpoint: string; p256dh: string; auth: string; user_agent: string | null }, options: { onConflict: string }) => Promise<{ error: { message: string } | null }>
    }
  }
  const { error } = await db.from('push_subscriptions').upsert({ organization_id: context.organizationId, user_id: context.user.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, user_agent: parsed.data.userAgent || request.headers.get('user-agent') }, { onConflict: 'user_id,endpoint' })
  if (error) return NextResponse.json({ error: 'Não foi possível salvar a subscription.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const context = await getContext(supabase)
  if (!context) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const parsed = deleteSchema.safeParse({ endpoint: new URL(request.url).searchParams.get('endpoint') })
  if (!parsed.success) return NextResponse.json({ error: 'Endpoint inválido.' }, { status: 400 })
  const endpoint = parsed.data.endpoint
  const db = supabase as unknown as {
    from: (table: 'push_subscriptions') => { delete: () => { eq: (column: string, value: string) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> } } }
  }
  const { error } = await db.from('push_subscriptions').delete().eq('user_id', context.user.id).eq('endpoint', endpoint)
  if (error) return NextResponse.json({ error: 'Não foi possível remover a subscription.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
