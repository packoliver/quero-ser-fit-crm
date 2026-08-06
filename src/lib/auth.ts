import { createClient } from '@/lib/supabase/server'
import { UserRole } from '@/types/database'

export interface UserAuthContext {
  authenticated: boolean
  userId: string | null
  userEmail: string | null
  organizationId: string | null
  role: UserRole | null
  error?: string
}

/**
 * Resolve e valida no servidor o usuário autenticado, sua organização ativa e sua função real (admin/attendant).
 * Nunca confia em dados enviados livremente pelo navegador.
 */
export async function getAuthenticatedUserContext(): Promise<UserAuthContext> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return {
        authenticated: false,
        userId: null,
        userEmail: null,
        organizationId: null,
        role: null,
        error: 'Sessão expirada ou usuário não autenticado.',
      }
    }

    // Consulta segura da associação do usuário à organização
    const { data: memberData, error: memberError } = await (supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            single: () => Promise<{ data: { organization_id: string; role: UserRole } | null; error: unknown }>
          }
        }
      }
    })
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .single()

    if (memberError || !memberData) {
      return {
        authenticated: false,
        userId: user.id,
        userEmail: user.email || null,
        organizationId: null,
        role: null,
        error: 'Usuário não possui associação ativa com nenhuma empresa no CRM.',
      }
    }

    return {
      authenticated: true,
      userId: user.id,
      userEmail: user.email || null,
      organizationId: memberData.organization_id,
      role: memberData.role,
    }
  } catch {
    return {
      authenticated: false,
      userId: null,
      userEmail: null,
      organizationId: null,
      role: null,
      error: 'Erro interno ao validar permissões de acesso.',
    }
  }
}
