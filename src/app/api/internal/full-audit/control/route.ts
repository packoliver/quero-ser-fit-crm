import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuditExecutorAuthorized } from '@/lib/ai/audit-auth'
import { applyAuditCommand } from '@/lib/ai/audit-control'

export const maxDuration = 150
const schema = z.object({ organizationId: z.string().uuid(), requestId: z.string().uuid() })
export async function POST(request: Request) {
  if (!isAuditExecutorAuthorized(request)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Solicitação inválida.' }, { status: 400 })
  try {
    return NextResponse.json(await applyAuditCommand(createAdminClient(), parsed.data.organizationId, parsed.data.requestId))
  } catch (error) {
    return NextResponse.json({ error: 'Não foi possível aplicar a solicitação salva.' },
      { status: error instanceof Error && error.message === 'COMMAND_MISSING' ? 404 : 502 })
  }
}
