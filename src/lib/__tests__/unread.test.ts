import { describe, it, expect } from 'vitest'
import {
  buildUnreadCounts,
  sumUnread,
  lastMessageTimestamp,
  formatUnreadBadge,
  type UnreadMessageInput,
} from '@/lib/inbox/unread'

const msg = (
  conversation_id: string,
  sender_type: string,
  created_at: string
): UnreadMessageInput => ({ conversation_id, sender_type, created_at })

describe('Contagem de mensagens não lidas', () => {
  it('deve contar tudo do cliente quando a conversa nunca foi aberta', () => {
    const counts = buildUnreadCounts(
      [
        msg('c1', 'contact', '2026-08-19T10:00:00Z'),
        msg('c1', 'contact', '2026-08-19T10:05:00Z'),
      ],
      []
    )
    expect(counts).toEqual({ c1: 2 })
  })

  it('deve contar só o que chegou depois da última leitura', () => {
    const counts = buildUnreadCounts(
      [
        msg('c1', 'contact', '2026-08-19T09:00:00Z'),
        msg('c1', 'contact', '2026-08-19T11:00:00Z'),
        msg('c1', 'contact', '2026-08-19T12:00:00Z'),
      ],
      [{ conversation_id: 'c1', last_read_at: '2026-08-19T10:00:00Z' }]
    )
    expect(counts).toEqual({ c1: 2 })
  })

  it('não deve contar a própria mensagem que marcou a leitura', () => {
    // markRead grava a data da mensagem mais recente já vista. Com `>=` no lugar de `>`,
    // essa mesma mensagem se contaria e a conversa nunca zeraria — ficaria eternamente
    // com "1 não lida" logo depois de ser aberta.
    const counts = buildUnreadCounts(
      [msg('c1', 'contact', '2026-08-19T10:00:00Z')],
      [{ conversation_id: 'c1', last_read_at: '2026-08-19T10:00:00Z' }]
    )
    expect(counts).toEqual({})
  })

  it('nunca deve contar mensagem da própria equipe', () => {
    // O CRM cobrando a vendedora de ler o que ela mesma escreveu seria absurdo — e
    // aconteceria em toda conversa, já que responder é o uso normal do sistema.
    const counts = buildUnreadCounts(
      [
        msg('c1', 'user', '2026-08-19T10:00:00Z'),
        msg('c1', 'system', '2026-08-19T10:01:00Z'),
      ],
      []
    )
    expect(counts).toEqual({})
  })

  it('deve deixar conversas zeradas FORA do mapa', () => {
    const counts = buildUnreadCounts(
      [msg('c1', 'user', '2026-08-19T10:00:00Z')],
      []
    )
    // Quem consome faz `counts[id] > 0` sem precisar distinguir ausente de zero.
    expect('c1' in counts).toBe(false)
  })

  it('deve separar a contagem por conversa e somar o total', () => {
    const counts = buildUnreadCounts(
      [
        msg('c1', 'contact', '2026-08-19T10:00:00Z'),
        msg('c2', 'contact', '2026-08-19T10:00:00Z'),
        msg('c2', 'contact', '2026-08-19T10:01:00Z'),
      ],
      []
    )
    expect(counts).toEqual({ c1: 1, c2: 2 })
    expect(sumUnread(counts)).toBe(3)
  })

  it('deve ignorar data inválida em vez de quebrar a lista', () => {
    const counts = buildUnreadCounts([msg('c1', 'contact', 'nao-e-data')], [])
    expect(counts).toEqual({})
  })
})

describe('Até quando marcar como visto', () => {
  const mensagens = [
    msg('c1', 'contact', '2026-08-19T10:00:00Z'),
    msg('c1', 'user', '2026-08-19T12:00:00Z'),
    msg('c1', 'contact', '2026-08-19T11:00:00Z'),
    msg('c2', 'contact', '2026-08-19T23:00:00Z'),
  ]

  it('deve usar a mensagem mais recente da conversa, independentemente da ordem', () => {
    expect(lastMessageTimestamp(mensagens, 'c1')).toBe('2026-08-19T12:00:00Z')
  })

  it('não deve vazar mensagem de outra conversa', () => {
    expect(lastMessageTimestamp(mensagens, 'c2')).toBe('2026-08-19T23:00:00Z')
  })

  it('deve devolver null quando a conversa não tem mensagem', () => {
    expect(lastMessageTimestamp(mensagens, 'c3')).toBeNull()
  })
})

describe('Rótulo da bolinha', () => {
  it('deve mostrar o número exato até 99', () => {
    expect(formatUnreadBadge(1)).toBe('1')
    expect(formatUnreadBadge(99)).toBe('99')
  })

  it('deve virar 99+ acima disso, pra não estourar a bolinha', () => {
    expect(formatUnreadBadge(100)).toBe('99+')
    expect(formatUnreadBadge(1234)).toBe('99+')
  })
})
