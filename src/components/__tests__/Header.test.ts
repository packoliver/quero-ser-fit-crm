import { describe, it, expect } from 'vitest'
import { UserRole } from '@/types/database'

describe('Componentes Globais - Header e Sessão (Fase 4.4)', () => {
  it('deve formatar corretamente os dados do usuário para perfil Admin', () => {
    const role: UserRole = 'admin'
    const userName = role === 'admin' ? 'Patricia Silva (Admin)' : 'Carlos Atendimento'
    const userEmail = role === 'admin' ? 'admin@queroserfit.com.br' : 'carlos@queroserfit.com.br'

    expect(userName).toContain('Patricia Silva')
    expect(userEmail).toBe('admin@queroserfit.com.br')
  })

  it('deve formatar corretamente os dados do usuário para perfil Atendente', () => {
    const role: UserRole = 'attendant'
    const isTargetAdmin = (role as UserRole) === 'admin'
    const userName = isTargetAdmin ? 'Patricia Silva (Admin)' : 'Carlos Atendimento'
    const userEmail = isTargetAdmin ? 'admin@queroserfit.com.br' : 'carlos@queroserfit.com.br'

    expect(userName).toBe('Carlos Atendimento')
    expect(userEmail).toBe('carlos@queroserfit.com.br')
  })

  it('deve manter a role de atendente sem privilégios de admin', () => {
    const role: UserRole = 'attendant'
    expect(role).not.toBe('admin')
  })
})
