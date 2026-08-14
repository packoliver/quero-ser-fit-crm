import { createClient } from '@/lib/supabase/client'
import type { OfflineScope } from './db'

export async function getOfflineScope(): Promise<OfflineScope | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: membership } = await (supabase as unknown as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { single: () => Promise<{ data: { organization_id: string } | null }> } } } })
    .from('organization_members').select('organization_id').eq('user_id', user.id).single()
  return membership ? { userId: user.id, organizationId: membership.organization_id } : null
}
