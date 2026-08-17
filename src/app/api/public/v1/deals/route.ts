import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateApiKey } from '@/lib/security/api-keys'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

/** GET /api/public/v1/deals — pedidos/negócios do funil (ver /api/public/v1/contacts pro
 * padrão geral de autenticação e paginação, idêntico aqui). */
export async function GET(request: NextRequest) {
  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Serviço indisponível.' },
      { status: 500 }
    )
  }

  const auth = await authenticateApiKey(request, admin)
  if (!auth) {
    return NextResponse.json({ error: 'Chave de API ausente ou inválida. Use "Authorization: Bearer <sua_chave>".' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit')) || DEFAULT_LIMIT))
  const offset = Math.max(0, Number(searchParams.get('offset')) || 0)

  const db = admin as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opt: { ascending: boolean }) => {
            range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
          }
        }
      }
    }
  }

  const { data, error } = await db
    .from('deals')
    .select('id, title, stage, value, contact_id, created_at, updated_at')
    .eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json({ error: 'Falha ao buscar pedidos.' }, { status: 500 })
  }

  return NextResponse.json({ data: data || [], limit, offset })
}
