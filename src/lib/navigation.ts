import {
  MessageSquare,
  Users,
  CheckSquare,
  Kanban,
  Clock3,
  BarChart3,
  UserCheck,
  Share2,
  History,
  Zap,
  Clock,
  Code2,
  ListOrdered,
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
  { href: '/funil', label: 'Funil', icon: Kanban },
  { href: '/follow-up', label: 'Follow-up', icon: Clock3 },
  { href: '/tarefas', label: 'Tarefas', icon: CheckSquare },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3, adminOnly: false },
  // Não é admin-only: é uma biblioteca de textos prontos pra equipe inteira usar no
  // Inbox, igual tags — não mexe com credenciais nem dados sensíveis.
  { href: '/configuracoes/respostas-rapidas', label: 'Respostas Rápidas', icon: Zap },
  { href: '/configuracoes/horario-atendimento', label: 'Automações', icon: Clock, adminOnly: true },
  // Não é sobre credenciais — é a lista de etapas do Kanban (Lead, Fechado, Perdido...).
  // adminOnly:true só pra não poluir o menu de quem atende; gerente continua vendo,
  // igual "Automações" (ver ADMIN_ONLY_HREFS logo abaixo pro que é restrito só a admin).
  { href: '/configuracoes/funil', label: 'Etapas do Funil', icon: ListOrdered, adminOnly: true },
  { href: '/configuracoes/equipe', label: 'Equipe', icon: UserCheck, adminOnly: true },
  { href: '/configuracoes/integracoes', label: 'Integrações', icon: Share2, adminOnly: true },
  { href: '/configuracoes/api', label: 'API Pública', icon: Code2, adminOnly: true },
  { href: '/configuracoes/auditoria', label: 'Auditoria', icon: History, adminOnly: true },
]

// Nav items only full admins should see, even though they're not literally about
// billing/danger-zone stuff — integrations and API keys hold live credentials, and the
// audit log is the security trail itself, so managers (who can otherwise do most admin
// things) are deliberately excluded from all three.
const ADMIN_ONLY_HREFS = ['/configuracoes/integracoes', '/configuracoes/api', '/configuracoes/auditoria']

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
