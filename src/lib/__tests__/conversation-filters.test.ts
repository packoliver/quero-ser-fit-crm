import { describe, it, expect } from 'vitest'
import {
  matchesConversationFilters,
  type FilterableConversation,
  type ConversationQueueFilter,
} from '@/lib/inbox/filters'

const EU = 'user-eu'
const OUTRA = 'user-outra'

const conversa = (over: Partial<FilterableConversation> = {}): FilterableConversation => ({
  id: 'c1',
  status: 'open',
  currentAssigneeId: null,
  channel: 'whatsapp',
  contactName: 'Maria Silva',
  contactPhone: '5565999990000',
  lastMessage: 'Quero fechar o pedido',
  ...over,
})

const passa = (
  c: FilterableConversation,
  queue: ConversationQueueFilter,
  extra: Partial<{ search: string; channel: 'all' | 'whatsapp' | 'instagram'; unreadCount: number; currentUserId: string | null }> = {}
) =>
  matchesConversationFilters(c, {
    queue,
    channel: extra.channel ?? 'all',
    search: extra.search ?? '',
    currentUserId: extra.currentUserId !== undefined ? extra.currentUserId : EU,
    unreadCount: extra.unreadCount ?? 0,
  })

describe('Filtros da lista de conversas', () => {
  it('deve tirar as encerradas de todas as abas menos "Encerradas"', () => {
    // O comportamento antigo: "Encerrar" só trocava o rótulo do cartão, e a conversa
    // continuava na lista ativa pra sempre, ocupando espaço entre as que precisam resposta.
    const encerrada = conversa({ status: 'closed', currentAssigneeId: EU })

    expect(passa(encerrada, 'active')).toBe(false)
    expect(passa(encerrada, 'mine')).toBe(false)
    expect(passa(encerrada, 'unassigned')).toBe(false)
    expect(passa(encerrada, 'unread', { unreadCount: 5 })).toBe(false)
    expect(passa(encerrada, 'closed')).toBe(true)
  })

  it('deve tratar "assigned" como conversa normal, e não como estado próprio', () => {
    // persist-event.ts reverte o status pra 'open' a cada mensagem recebida, mesmo com
    // responsável definido — quem responde "de quem é" é current_assignee_id. Se o filtro
    // olhasse o status, a mesma conversa entraria e sairia da aba sozinha.
    const comStatusAssigned = conversa({ status: 'assigned', currentAssigneeId: EU })
    const comStatusOpen = conversa({ status: 'open', currentAssigneeId: EU })

    expect(passa(comStatusAssigned, 'active')).toBe(true)
    expect(passa(comStatusAssigned, 'mine')).toBe(true)
    expect(passa(comStatusOpen, 'mine')).toBe(true)
  })

  it('deve separar minhas, sem responsável e de outra pessoa', () => {
    const minha = conversa({ currentAssigneeId: EU })
    const deOutra = conversa({ currentAssigneeId: OUTRA })
    const semDono = conversa({ currentAssigneeId: null })

    expect(passa(minha, 'mine')).toBe(true)
    expect(passa(deOutra, 'mine')).toBe(false)
    expect(passa(semDono, 'mine')).toBe(false)

    expect(passa(semDono, 'unassigned')).toBe(true)
    expect(passa(minha, 'unassigned')).toBe(false)

    // "Ativas" mostra tudo que não foi encerrado, inclusive o que é de outra pessoa.
    expect(passa(deOutra, 'active')).toBe(true)
  })

  it('não deve chamar conversa sem responsável de "minha" enquanto a sessão carrega', () => {
    // currentUserId nulo com currentAssigneeId nulo: sem a guarda, null === null daria
    // verdadeiro e a aba "Minhas" mostraria a fila inteira por um instante ao abrir o app.
    const semDono = conversa({ currentAssigneeId: null })
    expect(passa(semDono, 'mine', { currentUserId: null })).toBe(false)
  })

  it('deve filtrar não lidas pela contagem, não pelo status', () => {
    expect(passa(conversa(), 'unread', { unreadCount: 3 })).toBe(true)
    expect(passa(conversa(), 'unread', { unreadCount: 0 })).toBe(false)
  })

  it('deve respeitar o canal em qualquer aba', () => {
    const insta = conversa({ channel: 'instagram' })
    expect(passa(insta, 'active', { channel: 'instagram' })).toBe(true)
    expect(passa(insta, 'active', { channel: 'whatsapp' })).toBe(false)
    expect(passa(insta, 'active', { channel: 'all' })).toBe(true)
  })

  it('deve buscar por nome, telefone e conteúdo da última mensagem', () => {
    const c = conversa()
    expect(passa(c, 'active', { search: 'maria' })).toBe(true)
    expect(passa(c, 'active', { search: '99999' })).toBe(true)
    expect(passa(c, 'active', { search: 'pedido' })).toBe(true)
    expect(passa(c, 'active', { search: 'joão' })).toBe(false)
  })

  it('deve encontrar conversa encerrada na busca, mesmo fora da aba "Encerradas"', () => {
    // Sem isso, procurar um cliente pelo nome e não achar porque a conversa foi encerrada
    // é um beco sem saída — a pessoa não tem como saber que precisa trocar de aba.
    const encerrada = conversa({ status: 'closed' })
    expect(passa(encerrada, 'active', { search: 'maria' })).toBe(true)
  })

  it('deve manter responsável e canal valendo durante a busca', () => {
    // A busca atravessa só a divisão encerrada/ativa. Quem pediu "Minhas" quer as suas
    // mesmo procurando.
    const deOutra = conversa({ currentAssigneeId: OUTRA })
    expect(passa(deOutra, 'mine', { search: 'maria' })).toBe(false)

    const insta = conversa({ channel: 'instagram' })
    expect(passa(insta, 'active', { search: 'maria', channel: 'whatsapp' })).toBe(false)
  })
})
