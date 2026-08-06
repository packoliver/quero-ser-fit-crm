import { describe, it, expect } from 'vitest'
import { getNavItemsForRole } from '@/lib/navigation'

describe('Navegação e Permissões de Menu por Perfil (Fase 2)', () => {
  it('deve retornar todas as 6 opções de menu para o perfil Administrador', () => {
    const adminNav = getNavItemsForRole('admin')
    expect(adminNav.length).toBe(6)

    const labels = adminNav.map((n) => n.label)
    expect(labels).toContain('Conversas')
    expect(labels).toContain('Clientes')
    expect(labels).toContain('Tarefas')
    expect(labels).toContain('Relatórios')
    expect(labels).toContain('Equipe')
    expect(labels).toContain('Integrações')
  })

  it('deve ocultar Equipe e Integrações para o perfil Atendente', () => {
    const attendantNav = getNavItemsForRole('attendant')
    expect(attendantNav.length).toBe(4)

    const labels = attendantNav.map((n) => n.label)
    expect(labels).toContain('Conversas')
    expect(labels).toContain('Clientes')
    expect(labels).toContain('Tarefas')
    expect(labels).toContain('Relatórios')

    expect(labels).not.toContain('Equipe')
    expect(labels).not.toContain('Integrações')
  })
})
