import { UserRole, CustomPermissions } from '@/types/database'

export const DEFAULT_ADMIN_PERMISSIONS: CustomPermissions = {
  view_all_conversations: true,
  assume_conversations: true,
  transfer_conversations: true,
  close_conversations: true,
  delete_messages: true,
  create_clients: true,
  edit_clients: true,
  delete_clients: true,
  export_clients: true,
  view_client_notes: true,
  create_tasks: true,
  edit_tasks: true,
  create_deals: true,
  edit_deals: true,
  assign_tasks_to_others: true,
  delete_tasks: true,
  view_reports: true,
  export_reports: true,
  manage_attendants: true,
  manage_integrations: true,
  manage_pipeline_stages: true,
}

export const DEFAULT_MANAGER_PERMISSIONS: CustomPermissions = {
  view_all_conversations: true,
  assume_conversations: true,
  transfer_conversations: true,
  close_conversations: true,
  delete_messages: true,
  create_clients: true,
  edit_clients: true,
  delete_clients: true,
  export_clients: true,
  view_client_notes: true,
  create_tasks: true,
  edit_tasks: true,
  create_deals: true,
  edit_deals: true,
  assign_tasks_to_others: true,
  delete_tasks: true,
  view_reports: true,
  export_reports: true,
  manage_attendants: true,
  manage_integrations: false,
  manage_pipeline_stages: true,
}

export const DEFAULT_ATTENDANT_PERMISSIONS: CustomPermissions = {
  // TRUE por padrão de propósito (não FALSE): até 2026-08-18 esse valor nunca era
  // enforced em lugar nenhum (nem RLS, nem RPC) — todo attendant sempre viu todas as
  // conversas da organização na prática, então o default precisa continuar refletindo
  // isso. Só passa a restringir de verdade quando um admin desmarca a caixinha "Ver
  // todas as conversas" pra alguém específico em Configurações > Equipe (ver migration
  // 20260818000000_enforce_transfer_and_view_permissions.sql).
  view_all_conversations: true,
  assume_conversations: true,
  transfer_conversations: true,
  close_conversations: true,
  delete_messages: false,
  create_clients: true,
  edit_clients: true,
  delete_clients: false,
  export_clients: false,
  view_client_notes: true,
  create_tasks: true,
  edit_tasks: true,
  create_deals: true,
  edit_deals: true,
  assign_tasks_to_others: false,
  delete_tasks: false,
  view_reports: true,
  export_reports: false,
  manage_attendants: false,
  manage_integrations: false,
  manage_pipeline_stages: false,
}

export function getDefaultPermissionsForRole(role: UserRole): CustomPermissions {
  if (role === 'admin') return DEFAULT_ADMIN_PERMISSIONS
  if (role === 'manager') return DEFAULT_MANAGER_PERMISSIONS
  return DEFAULT_ATTENDANT_PERMISSIONS
}

export function hasPermission(
  role: UserRole,
  customPermissions: CustomPermissions | null | undefined,
  permission: keyof CustomPermissions
): boolean {
  // Admins always have all permissions enabled by default
  if (role === 'admin') return true

  const defaults = getDefaultPermissionsForRole(role)
  if (customPermissions && typeof customPermissions[permission] === 'boolean') {
    return customPermissions[permission]!
  }

  return !!defaults[permission]
}
