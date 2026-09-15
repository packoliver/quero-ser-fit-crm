import { describe, it, expect } from 'vitest'
import { __testing } from '@/lib/ai/insights'

const { buildTranscript, buildQaContext } = __testing

describe('Insights — montagem da transcrição pra IA', () => {
  it('deve rotular cada linha por quem mandou e formatar hora em pt-BR', () => {
    const transcript = buildTranscript([
      { id: '1', sender_type: 'contact', content: 'Oi, quanto custa?', media_url: null, created_at: '2026-09-15T14:32:00Z' },
      { id: '2', sender_type: 'user', content: 'R$99/mês', media_url: null, created_at: '2026-09-15T14:35:00Z' },
    ])
    expect(transcript).toContain('Cliente: Oi, quanto custa?')
    expect(transcript).toContain('Atendente: R$99/mês')
  })

  it('deve marcar mensagem sem texto como mídia quando há media_url', () => {
    const transcript = buildTranscript([
      { id: '1', sender_type: 'contact', content: '', media_url: 'https://x/foto.jpg', created_at: '2026-09-15T14:32:00Z' },
    ])
    expect(transcript).toContain('[mídia enviada]')
  })

  it('deve manter a ordem das mensagens como recebida (mais antiga primeiro)', () => {
    const transcript = buildTranscript([
      { id: '1', sender_type: 'contact', content: 'primeira', media_url: null, created_at: '2026-09-15T14:00:00Z' },
      { id: '2', sender_type: 'user', content: 'segunda', media_url: null, created_at: '2026-09-15T14:05:00Z' },
    ])
    expect(transcript.indexOf('primeira')).toBeLessThan(transcript.indexOf('segunda'))
  })
})

describe('Insights — montagem do contexto pra "Pergunte à IA"', () => {
  it('deve incluir cliente, vendedor(a), status e desfecho de cada linha', () => {
    const context = buildQaContext(
      [{ conversation_id: 'c1', deal_id: 'd1', status: 'risco', outcome: 'perdida', outcome_reason: 'achou caro', summary: 'não fechou' }],
      new Map([['c1', 'Maria Silva']]),
      new Map([['d1', 'João Vendedor']])
    )
    expect(context).toContain('Cliente: Maria Silva')
    expect(context).toContain('Vendedor(a): João Vendedor')
    expect(context).toContain('Status: risco')
    expect(context).toContain('perdida (achou caro)')
  })

  it('deve usar travessão quando não há vendedor(a) associado (pedido sem deal)', () => {
    const context = buildQaContext(
      [{ conversation_id: 'c1', deal_id: null, status: 'ok', outcome: 'aberta', outcome_reason: null, summary: 'conversa tranquila' }],
      new Map([['c1', 'Maria Silva']]),
      new Map()
    )
    expect(context).toContain('Vendedor(a): —')
  })

  it('deve cair em "desconhecido" quando o cliente não está no mapa', () => {
    const context = buildQaContext(
      [{ conversation_id: 'c-nao-mapeado', deal_id: null, status: 'ok', outcome: 'aberta', outcome_reason: null, summary: '' }],
      new Map(),
      new Map()
    )
    expect(context).toContain('Cliente: desconhecido')
  })
})
