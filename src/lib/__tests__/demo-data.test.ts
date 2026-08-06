import { describe, it, expect } from 'vitest'
import {
  demoConversations,
  demoContacts,
  demoTasks,
  demoIntegrations,
  demoReportMetrics,
} from '@/lib/demo'

describe('Dados de Demonstração Centralizados (Fase 2)', () => {
  it('deve conter conversas simuladas marcadas explicitamente como demonstração', () => {
    expect(demoConversations.length).toBeGreaterThan(0)
    expect(demoConversations.every((c) => c.isDemo === true)).toBe(true)
  })

  it('deve conter contatos simulados com canais e tags válidas', () => {
    expect(demoContacts.length).toBeGreaterThan(0)
    expect(demoContacts.every((c) => c.isDemo === true)).toBe(true)
  })

  it('deve conter tarefas simuladas vinculadas a clientes e atendentes', () => {
    expect(demoTasks.length).toBeGreaterThan(0)
    expect(demoTasks.every((t) => t.isDemo === true)).toBe(true)
  })

  it('deve exibir conectores de integração como não configurados', () => {
    expect(demoIntegrations.length).toBeGreaterThan(0)
    expect(demoIntegrations.every((i) => i.status === 'not_configured')).toBe(true)
  })

  it('deve conter indicador explicito de métricas simuladas nos relatórios', () => {
    expect(demoReportMetrics.isDemo).toBe(true)
    expect(demoReportMetrics.totalConversations).toBeGreaterThan(0)
  })
})
