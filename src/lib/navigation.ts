import {
  MessageSquare,
  Users,
  CheckSquare,
  BarChart3,
  UserCheck,
  Share2,
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
]

export function getNavItemsForRole(role: UserRole): NavItem[] {
  if (role === 'admin') {
    return allNavItems
  }
  // Attendants only see non-admin items (Conversas, Clientes, Tarefas, Relatórios)
  return allNavItems.filter((item) => !item.adminOnly)
}
