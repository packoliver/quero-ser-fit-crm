import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateApiKey } from '@/lib/security/api-keys'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

/**
 * GET /api/public/v1/contacts — lista os clientes da organização dona da chave de API
 * usada. Pensado pra consumo por Zapier ("Webhooks by Zapier" em modo polling),
 * planilhas (Apps Script), Make, n8n, ou um script simples — qualquer ferramenta que
 * saiba fazer um GET autenticado.
 *
 * Paginação por offset (?limit=50&offset=0) — simples de usar em qualquer ferramenta
 * no-code, suficiente pro volume de uma única organização deste CRM.
 */
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
    .from('contacts')
    .select('id, name, email, phone, tags, notes, status, created_at')
    .eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json({ error: 'Falha ao buscar clientes.' }, { status: 500 })
  }

  return NextResponse.json({ data: data || [], limit, offset })
}
