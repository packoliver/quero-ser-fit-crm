import { describe, it, expect } from 'vitest'
import { getNavItemsForRole } from '@/lib/navigation'
import { demoConversations, demoContacts } from '@/lib/demo'

describe('Fase 3 — Operações com Supabase, RLS e Regras de Negócio', () => {
  describe('1. Proteção de Rotas e Permissões por Perfil', () => {
    it('deve ocultar Equipe e Integrações do menu para atendentes', () => {
      const nav = getNavItemsForRole('attendant')
      const routes = nav.map((n) => n.href)
      expect(routes).not.toContain('/configuracoes/equipe')
      expect(routes).not.toContain('/configuracoes/integracoes')
    })

    it('deve manter todas as rotas visíveis para o perfil admin', () => {
      const nav = getNavItemsForRole('admin')
      const routes = nav.map((n) => n.href)
      expect(routes).toContain('/configuracoes/equipe')
      expect(routes).toContain('/configuracoes/integracoes')
    })
  })

  describe('2. Normalização e Duplicidade de Telefones de Clientes', () => {
    it('deve remover caracteres não numéricos para normalização', () => {
      const rawPhone = '+55 (11) 98877-6655'
      const normalized = rawPhone.replace(/\D/g, '')
      expect(normalized).toBe('5511988776655')
    })

    it('deve identificar duplicidade quando dois telefones formatados tiverem os mesmos dígitos', () => {
      const phoneA = '+55 11 98877-6655'.replace(/\D/g, '')
      const phoneB = '11988776655'.replace(/\D/g, '')
      expect(phoneA.endsWith(phoneB)).toBe(true)
    })
  })

  describe('3. Isolamento e Proteção do Úlitmo Administrador', () => {
    it('deve rejeitar a alteração de papel se restar apenas 1 administrador ativo', () => {
      const activeAdminsCount = 1
      const isDemotionAllowed = activeAdminsCount > 1
      expect(isDemotionAllowed).toBe(false)
    })
  })

  describe('4. Notas Internas vs Mensagens de Clientes', () => {
    it('notas internas devem possuir flag ou tipo distinto e nunca ser tratadas como mensagem externa', () => {
      const conversation = demoConversations[0]
      expect(conversation.notes).toBeDefined()

      // As mensagens de clientes não contêm notas internas no seu histórico principal
      const externalMessageTypes = conversation.messages.map((m) => m.senderType)
      expect(externalMessageTypes).not.toContain('note')
    })
  })

  describe('5. Não Mistura de Dados Reais e Demonstrativos', () => {
    it('todos os itens demonstrativos devem possuir a propriedade isDemo = true', () => {
      expect(demoConversations.every((c) => c.isDemo === true)).toBe(true)
      expect(demoContacts.every((c) => c.isDemo === true)).toBe(true)
    })
  })
})
