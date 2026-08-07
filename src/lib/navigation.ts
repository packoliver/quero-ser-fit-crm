import {
  MessageSquare,
  Users,
  CheckSquare,
  BarChart3,
  UserCheck,
  Share2,
  History,
  type LucideIcon,
} from 'lucide-react'
import { UserRole } from '@/types/database'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
}

export const allNavItems: NavItem[] = [
  { href: '/inbox', label: 'Conversas', icon: MessageSquare },
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/tarefas', label: 'Tarefas', icon: CheckSquare },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3, adminOnly: false },
  { href: '/configuracoes/equipe', label: 'Equipe', icon: UserCheck, adminOnly: true },
  { href: '/configuracoes/integracoes', label: 'Integrações', icon: Share2, adminOnly: true },
  { href: '/configuracoes/auditoria', label: 'Auditoria', icon: History, adminOnly: true },
]

// Nav items only full admins should see, even though they're not literally about
// billing/danger-zone stuff — integrations hold live API credentials, and the audit
// log is the security trail itself, so managers (who can otherwise do most admin
// things) are deliberately excluded from both.
const ADMIN_ONLY_HREFS = ['/configuracoes/integracoes', '/configuracoes/auditoria']

export function getNavItemsForRole(role: UserRole): NavItem[] {
  if (role === 'admin') {
    return allNavItems
  }
  if (role === 'manager') {
    return allNavItems.filter((item) => !ADMIN_ONLY_HREFS.includes(item.href))
  }
  // Attendants see non-admin items (Conversas, Clientes, Tarefas, Relatórios)
  return allNavItems.filter((item) => !item.adminOnly)
}
