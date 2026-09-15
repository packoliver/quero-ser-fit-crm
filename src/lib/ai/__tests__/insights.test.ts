import { describe, it, expect } from 'vitest'
import { __testing } from '@/lib/ai/insights'

const { buildTranscript } = __testing

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
