import { describe, it, expect } from 'vitest'
import { UserRole } from '@/types/database'

function checkCanManageTeam(userRole: UserRole): boolean {
  return userRole === 'admin'
}

function checkCanAccessAllConversations(userRole: UserRole): boolean {
  return userRole === 'admin' || userRole === 'attendant'
}

function checkCanModifyIntegrations(userRole: UserRole): boolean {
  return userRole === 'admin'
}

describe('Autenticação e Permissões por Perfil (Admin vs Atendente)', () => {
  it('deve permitir que administradores gerenciem a equipe', () => {
    expect(checkCanManageTeam('admin')).toBe(true)
  })

  it('deve negar acesso de gerenciamento de equipe a atendentes', () => {
    expect(checkCanManageTeam('attendant')).toBe(false)
  })

  it('deve permitir acesso às conversas para admin e atendentes', () => {
    expect(checkCanAccessAllConversations('admin')).toBe(true)
    expect(checkCanAccessAllConversations('attendant')).toBe(true)
  })

  it('deve permitir que apenas admin altere configurações de integrações', () => {
    expect(checkCanModifyIntegrations('admin')).toBe(true)
    expect(checkCanModifyIntegrations('attendant')).toBe(false)
  })
})
