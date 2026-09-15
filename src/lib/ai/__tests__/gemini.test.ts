import { describe, it, expect } from 'vitest'
import { __testing } from '@/lib/ai/gemini'

const { parseResponse, buildPrompt } = __testing

describe('Análise de conversa por IA — parsing da resposta do Gemini', () => {
  it('deve aceitar uma resposta bem formada', () => {
    const result = parseResponse(
      JSON.stringify({
        status: 'risco',
        signals: ['cliente esperando há 2h', 'pergunta sobre preço não respondida'],
        summary: 'Cliente perguntou o preço e não teve resposta há 2 horas.',
        outcome: 'aberta',
        outcomeReason: '',
      }),
      null
    )
    expect(result).toEqual({
      status: 'risco',
      signals: ['cliente esperando há 2h', 'pergunta sobre preço não respondida'],
      summary: 'Cliente perguntou o preço e não teve resposta há 2 horas.',
      outcome: 'aberta',
      outcomeReason: null,
    })
  })

  it('deve devolver null pra JSON inválido, sem lançar exceção', () => {
    expect(parseResponse('isto não é json', null)).toBeNull()
  })

  it('deve devolver null quando falta o campo status ou ele tem um valor fora do enum', () => {
    expect(parseResponse(JSON.stringify({ signals: [], summary: '', outcome: 'aberta', outcomeReason: '' }), null)).toBeNull()
    expect(parseResponse(JSON.stringify({ status: 'inventado', signals: [], summary: '', outcome: 'aberta', outcomeReason: '' }), null)).toBeNull()
  })

  it('quando o desfecho já é conhecido (finalize), ele prevalece sobre o que a IA respondeu', () => {
    // A IA às vezes "erra" e ecoa um outcome diferente do que foi mandado — o outcome
    // conhecido (vindo da mudança de etapa real no Funil) é a fonte da verdade, não a IA.
    const result = parseResponse(
      JSON.stringify({ status: 'ok', signals: [], summary: 'Fechou a compra.', outcome: 'aberta', outcomeReason: 'Fechou o plano mensal' }),
      'ganha'
    )
    expect(result?.outcome).toBe('ganha')
    expect(result?.outcomeReason).toBe('Fechou o plano mensal')
  })

  it('deve limitar sinais a no máximo 5 e descartar itens que não são string', () => {
    const result = parseResponse(
      JSON.stringify({
        status: 'atencao',
        signals: ['a', 'b', 'c', 'd', 'e', 'f', 123, null],
        summary: '',
        outcome: 'aberta',
        outcomeReason: '',
      }),
      null
    )
    expect(result?.signals).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('outcomeReason deve virar null quando outcome é "aberta", mesmo que a IA tenha preenchido algo', () => {
    const result = parseResponse(
      JSON.stringify({ status: 'ok', signals: [], summary: '', outcome: 'aberta', outcomeReason: 'motivo que não deveria valer aqui' }),
      null
    )
    expect(result?.outcomeReason).toBeNull()
  })
})

describe('Análise de conversa por IA — construção do prompt', () => {
  it('deve incluir a transcrição e instruir a IA a não decidir o desfecho quando ele já é conhecido', () => {
    const prompt = buildPrompt('[10:00] Cliente: oi', 'perdida')
    expect(prompt).toContain('[10:00] Cliente: oi')
    expect(prompt).toContain('PERDIDA')
    expect(prompt).toContain('Não contradiga esse resultado')
  })

  it('sem desfecho conhecido, deve pedir pra IA avaliar o estado sozinha', () => {
    const prompt = buildPrompt('[10:00] Cliente: oi', null)
    expect(prompt).toContain('Avalie, só pelo conteúdo da conversa')
  })
})
