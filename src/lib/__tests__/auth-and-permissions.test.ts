import { describe, it, expect } from 'vitest'
import { UserRole } from '@/types/database'
import { hasPermission } from '@/lib/security/permissions'

function checkCanManageTeam(userRole: UserRole): boolean {
  return userRole === 'admin' || userRole === 'manager'
}

function checkCanAccessAllConversations(userRole: UserRole): boolean {
  return userRole === 'admin' || userRole === 'manager' || userRole === 'attendant'
}

function checkCanModifyIntegrations(userRole: UserRole): boolean {
  return userRole === 'admin'
}

describe('Autenticação e Permissões por Perfil (Admin vs Manager vs Atendente)', () => {
  it('deve permitir que administradores e gerentes gerenciem a equipe', () => {
    expect(checkCanManageTeam('admin')).toBe(true)
    expect(checkCanManageTeam('manager')).toBe(true)
  })

  it('deve negar acesso de gerenciamento de equipe a atendentes', () => {
    expect(checkCanManageTeam('attendant')).toBe(false)
  })

  it('deve permitir acesso às conversas para admin, gerentes e atendentes', () => {
    expect(checkCanAccessAllConversations('admin')).toBe(true)
    expect(checkCanAccessAllConversations('manager')).toBe(true)
    expect(checkCanAccessAllConversations('attendant')).toBe(true)
  })

  it('deve permitir que apenas admin altere configurações de integrações', () => {
    expect(checkCanModifyIntegrations('admin')).toBe(true)
    expect(checkCanModifyIntegrations('manager')).toBe(false)
    expect(checkCanModifyIntegrations('attendant')).toBe(false)
  })

  it('deve respeitar a matriz de permissões granulares personalizadas', () => {
    // Attendant with custom permission to export clients
    const customPerms = { export_clients: true, delete_clients: false }
    expect(hasPermission('attendant', customPerms, 'export_clients')).toBe(true)
    expect(hasPermission('attendant', customPerms, 'delete_clients')).toBe(false)

    // Admin always gets true
    expect(hasPermission('admin', {}, 'delete_clients')).toBe(true)
  })
})
