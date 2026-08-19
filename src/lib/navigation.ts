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
  MoreHorizontal,
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

/**
 * As três áreas que ganham lugar fixo na barra inferior do celular. O resto vai pra
 * /mais.
 *
 * Isso é uma camada de APRESENTAÇÃO em cima de getNavItemsForRole, de propósito: quem
 * decide o que cada cargo pode ver continua sendo só aquela função (e o RLS no banco por
 * trás dela). Aqui só se escolhe quais dos itens já permitidos cabem no polegar — a barra
 * mostrava os 13 de uma vez, o que num aparelho de 375px dava uns 28px por item.
 *
 * O critério pra entrar aqui é frequência de uso no atendimento do dia a dia, não
 * importância: Clientes e Relatórios importam muito, mas são consultados de vez em quando,
 * enquanto a conversa é aberta o tempo todo.
 */
export const MOBILE_PRIMARY_HREFS = ['/inbox', '/funil', '/tarefas']

export const MORE_NAV_ITEM: NavItem = { href: '/mais', label: 'Mais', icon: MoreHorizontal }

/** Os itens da barra inferior, já filtrados pelo cargo — sem o botão "Mais", que é fixo. */
export function getMobilePrimaryNavItems(role: UserRole): NavItem[] {
  const allowed = getNavItemsForRole(role)
  // Percorre MOBILE_PRIMARY_HREFS (e não `allowed`) pra a ordem da barra ser a daqui,
  // estável, em vez de depender da ordem de declaração de allNavItems.
  return MOBILE_PRIMARY_HREFS.map((href) => allowed.find((item) => item.href === href)).filter(
    (item): item is NavItem => Boolean(item)
  )
}

/** Tudo que o cargo pode ver e NÃO está na barra inferior — é o conteúdo da tela /mais. */
export function getMoreNavItems(role: UserRole): NavItem[] {
  return getNavItemsForRole(role).filter((item) => !MOBILE_PRIMARY_HREFS.includes(item.href))
}
