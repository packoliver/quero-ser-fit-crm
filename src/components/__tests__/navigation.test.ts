import { describe, it, expect } from 'vitest'
import { getNavItemsForRole } from '@/lib/navigation'

describe('Navegação e Permissões de Menu por Perfil (Fase 2)', () => {
  it('deve retornar todas as 12 opções de menu para o perfil Administrador', () => {
    const adminNav = getNavItemsForRole('admin')
    expect(adminNav.length).toBe(12)

    const labels = adminNav.map((n) => n.label)
    expect(labels).toContain('Conversas')
    expect(labels).toContain('Clientes')
    expect(labels).toContain('Funil')
    expect(labels).toContain('Follow-up')
    expect(labels).toContain('Tarefas')
    expect(labels).toContain('Relatórios')
    expect(labels).toContain('Respostas Rápidas')
    expect(labels).toContain('Automações')
    expect(labels).toContain('Equipe')
    expect(labels).toContain('Integrações')
    expect(labels).toContain('API Pública')
    expect(labels).toContain('Auditoria')
  })

  it('deve ocultar Equipe e Integrações para o perfil Atendente', () => {
    const attendantNav = getNavItemsForRole('attendant')
    expect(attendantNav.length).toBe(7)

    const labels = attendantNav.map((n) => n.label)
    expect(labels).toContain('Conversas')
    expect(labels).toContain('Clientes')
    expect(labels).toContain('Funil')
    expect(labels).toContain('Follow-up')
    expect(labels).toContain('Tarefas')
    expect(labels).toContain('Relatórios')
    expect(labels).toContain('Respostas Rápidas')

    expect(labels).not.toContain('Equipe')
    expect(labels).not.toContain('Integrações')
  })

  it('deve ocultar Integrações e Auditoria (mas manter Equipe) para o perfil Gerente', () => {
    const managerNav = getNavItemsForRole('manager')
    const labels = managerNav.map((n) => n.label)

    expect(labels).toContain('Equipe')
    expect(labels).not.toContain('Integrações')
    expect(labels).not.toContain('Auditoria')
  })
})
