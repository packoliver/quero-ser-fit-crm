import { describe, it, expect } from 'vitest'
import {
  getNavItemsForRole,
  getMobilePrimaryNavItems,
  getMoreNavItems,
  MOBILE_PRIMARY_HREFS,
} from '@/lib/navigation'
import { UserRole } from '@/types/database'

describe('Navegação e Permissões de Menu por Perfil (Fase 2)', () => {
  it('deve retornar todas as 13 opções de menu para o perfil Administrador', () => {
    const adminNav = getNavItemsForRole('admin')
    expect(adminNav.length).toBe(13)

    const labels = adminNav.map((n) => n.label)
    expect(labels).toContain('Conversas')
    expect(labels).toContain('Clientes')
    expect(labels).toContain('Funil')
    expect(labels).toContain('Follow-up')
    expect(labels).toContain('Tarefas')
    expect(labels).toContain('Relatórios')
    expect(labels).toContain('Respostas Rápidas')
    expect(labels).toContain('Automações')
    expect(labels).toContain('Etapas do Funil')
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

describe('Navegação mobile: barra inferior enxuta + tela "Mais"', () => {
  const roles: UserRole[] = ['admin', 'manager', 'attendant']

  it('deve limitar a barra inferior a 3 itens fixos (+ "Mais") em todos os cargos', () => {
    for (const role of roles) {
      const primary = getMobilePrimaryNavItems(role)
      // 3 + o botão "Mais" = 4 alvos de toque, o teto confortável num aparelho de 375px.
      // Antes a barra recebia a lista inteira: 13 itens no admin, 7 no atendente.
      expect(primary.length).toBe(3)
      expect(primary.map((i) => i.href)).toEqual(['/inbox', '/funil', '/tarefas'])
    }
  })

  it('não deve perder nenhum item: barra + "Mais" reconstroem o menu completo do cargo', () => {
    for (const role of roles) {
      const completo = getNavItemsForRole(role).map((i) => i.href).sort()
      const dividido = [
        ...getMobilePrimaryNavItems(role).map((i) => i.href),
        ...getMoreNavItems(role).map((i) => i.href),
      ].sort()

      // A reestruturação é só de apresentação — nada pode virar inalcançável no celular
      // por ter saído da barra inferior.
      expect(dividido).toEqual(completo)
    }
  })

  it('deve manter o recorte de permissão dentro da tela "Mais"', () => {
    const atendente = getMoreNavItems('attendant').map((i) => i.label)
    expect(atendente).toContain('Clientes')
    expect(atendente).toContain('Relatórios')
    // "Mais" não pode virar porta dos fundos pro que o cargo não enxerga.
    expect(atendente).not.toContain('Equipe')
    expect(atendente).not.toContain('Integrações')
    expect(atendente).not.toContain('Auditoria')

    expect(getMoreNavItems('manager').map((i) => i.label)).not.toContain('Integrações')
  })

  it('não deve repetir na tela "Mais" o que já está na barra inferior', () => {
    for (const role of roles) {
      const maisHrefs = getMoreNavItems(role).map((i) => i.href)
      for (const href of MOBILE_PRIMARY_HREFS) {
        expect(maisHrefs).not.toContain(href)
      }
    }
  })
})
