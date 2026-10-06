import { describe, expect, it } from 'vitest'
import { FORENSIC_STATUSES, validateForensicAnalysis, forensicAuditTriggers } from '../audit-forensic'
import { buildForensicLedger } from '../audit-forensic-report'
import { findPaymentEmojiSignals, isApprovalEmoji } from '../audit-emoji'
import type { AuditMessage } from '../audit-model'
import type { AuditRun, ConversationAudit } from '../full-audit'
import { forensicFixture } from './forensic-fixture'

const id = (index: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`
const message = (index: number, content: string, sender_type = 'contact', extra: Partial<AuditMessage> = {}): AuditMessage => ({
  id: id(index), content, sender_type, sender_id: null, media_url: null, media_type: null, created_at: `2026-10-01T12:0${index}:00Z`, ...extra })
const cite = (item: AuditMessage, source: 'text' | 'image_description' = 'text') => ({ messageId: item.id, source, quote: source === 'text' ? item.content! : item.mediaInterpretation!.text })
describe('Critérios forenses e confirmação contextual', () => {
  it.each(['✅', '👍🏽', '🙏', '❤️', '🥰', '💚', '☺️', '👏', '🎉'])('reconhece %s somente como sinal contextual depois de relato de Pix', emoji => {
    const messages = [message(0, 'Chave Pix da loja'), message(1, 'Fiz o Pix'), message(2, emoji, 'user')]
    expect(isApprovalEmoji(emoji)).toBe(true)
    const signals = findPaymentEmojiSignals(messages, id(99))
    expect(signals).toHaveLength(1); expect(signals[0].confidence).toBe('media')
    expect(signals[0].description).toContain('precisam de conferência')
  })
  it('não transforma emoji de saudação, chave ou cliente em confirmação', () => {
    expect(findPaymentEmojiSignals([message(0, 'Chave Pix'), message(1, 'Qual o valor?'), message(2, '👍', 'user')], id(99))).toEqual([])
    expect(findPaymentEmojiSignals([message(0, 'Fiz Pix'), message(1, '👍')], id(99))).toEqual([])
    expect(findPaymentEmojiSignals([message(0, 'Bom dia'), message(1, '❤️', 'user')], id(99))).toEqual([])
    expect(isApprovalEmoji('Vou conferir ✅')).toBe(false)
  })
  it('rejeita comprovante inventado e confirmação só por emoji sem imagem inspecionada', () => {
    const paid = message(0, 'Fiz o Pix'), emoji = message(1, '🙏', 'user')
    const result = forensicFixture({ status: 'GANHA', closingType: 'PIX_CONFIRMADO_POR_EMOJI', confidence: 'ALTA',
      emojiAcknowledgement: true, evidence: [cite(paid), cite(emoji)] })
    expect(() => validateForensicAnalysis(result, [paid, emoji])).toThrow('comprovante inspecionado')
    expect(() => validateForensicAnalysis({ ...result, receiptSeen: true }, [paid, emoji])).toThrow('inspeção visual')
  })
  it('aceita comprovante visto + emoji + entrega, sem depender do status do CRM', () => {
    const image = message(1, '', 'contact', { media_type: 'image', mediaInterpretation: { kind: 'image_description', state: 'interpreted', text: 'Comprovante Pix realizado.', limitations: [] } })
    const emoji = message(2, '🙏', 'user'), delivery = message(3, 'Pedido enviado com o motoboy', 'user')
    const result = forensicFixture({ status: 'GANHA', confidence: 'ALTA', basis: 'CONFIRMADO', closingType: 'PIX_CONFIRMADO_POR_EMOJI',
      receiptSeen: true, emojiAcknowledgement: true, motoboy: true, relevantImageIds: [image.id], evidence: [cite(image, 'image_description'), cite(emoji), cite(delivery)] })
    expect(validateForensicAnalysis(result, [image, emoji, delivery]).status).toBe('GANHA')
  })
  it('QR code ou Pix agendado não é comprovante de pagamento concluído', () => {
    for (const text of ['QR Code Pix para pagar.', 'Comprovante Pix agendado.']) {
      const image = message(1, '', 'contact', { media_type: 'image', mediaInterpretation: { kind: 'image_description', state: 'interpreted', text, limitations: [] } })
      expect(() => validateForensicAnalysis(forensicFixture({ status: 'GANHA', closingType: 'PIX_COMPROVADO', receiptSeen: true, evidence: [cite(image, 'image_description')] }), [image])).toThrow()
    }
  })
  it('permite fechamento com pagamento na entrega e sinaliza imagem relevante indisponível', () => {
    const confirmed = message(1, 'Pedido confirmado, pagar na entrega', 'user'), image = message(2, '', 'contact', { media_type: 'image' })
    const result = validateForensicAnalysis(forensicFixture({ status: 'GANHA', confidence: 'ALTA', closingType: 'PAGAMENTO_NA_ENTREGA',
      paymentOnDelivery: true, evidence: [cite(confirmed)], relevantImageIds: [image.id] }), [confirmed, image])
    expect(result.confidence).toBe('MEDIA'); expect(result.receiptSeen).toBe(false)
  })
  it('não aceita valor sem evidência ou erro com citação de outra conversa', () => {
    expect(() => validateForensicAnalysis(forensicFixture({ value: 123 }), [])).toThrow('Valor sem evidência')
    expect(() => validateForensicAnalysis(forensicFixture({ errors: [{ code: 'E06', basis: 'CONFIRMADO', description: 'Sem follow-up', evidence: [{ messageId: id(99), source: 'text', quote: 'Inventado' }] }] }), [])).toThrow('evidência')
  })
  it('gera gatilhos de segunda passagem para pagamentos, imagens, logística, confiança e divergências', () => {
    const result = forensicFixture({ status: 'PERDIDA', lossReason: 'CLIENTE_DESISTIU' })
    expect(forensicAuditTriggers([message(1, 'pix comprovante motoboy', 'contact', { media_type: 'image' })], result, 'ganha')).toEqual(expect.arrayContaining(['pagamento', 'logistica', 'imagem_no_final', 'divergencia_crm', 'revisao_manual']))
  })
})

describe('Contabilidade individual das cinco categorias', () => {
  const run = { id: id(9000), organizationId: id(9001), version: 'v6', status: 'completed', cutoff: '2026-10-02',
    conversations: Array.from({ length: 905 }, (_, index) => ({ id: id(index), channel: index % 2 ? 'whatsapp' : 'instagram', state: 'completed' })) } as AuditRun
  const results = run.conversations.map((conversation, index) => ({ conversationId: conversation.id, channel: conversation.channel,
    coverage: { to: '2026-10-01' }, recordedOutcome: index === 0 ? 'perdida' : null,
    forensic: forensicFixture({ status: FORENSIC_STATUSES[index % 5], confidence: index % 5 === 4 ? 'BAIXA' : 'ALTA' }),
    quality: { secondPassAt: '2026-10-02' }, media: [] })) as unknown as ConversationAudit[]
  it('reconcilia exatamente 905 linhas sem contar duplicidades de resultado', () => {
    const report = buildForensicLedger(run, [...results, results[0]])
    expect(report.rows).toHaveLength(905); expect(report.summary.effective).toBe(905)
    expect(Object.values(report.summary.counts)).toEqual([181, 181, 181, 181, 181])
    expect(report.summary.sum).toBe(905); expect(report.summary.complete).toBe(true)
    expect(report.summary.metrics[0]).toMatchObject({ numerator: 181, denominator: 905, percent: 20 })
    expect(report.rows[0].crmDivergence).toBe(true)
  })
  it('não contabiliza revisão antiga ou conversa sem segunda passagem como forense concluída', () => {
    const older = { ...results[0], quality: undefined }, incomplete = { ...results[1], forensic: undefined }
    const report = buildForensicLedger(run, [older, incomplete, ...results.slice(2)])
    expect(report.summary.effective).toBe(903); expect(report.summary.notAnalyzed).toBe(2)
    expect(report.summary.notAnalyzedIds.map(item => item.conversationId)).toEqual([id(0), id(1)])
    expect(report.summary.complete).toBe(false); expect(report.summary.reconciled).toBe(true)
  })
  it('fila manual inclui inconclusivas, ganha com confiança baixa e divergência', () => {
    const low = { ...results[0], forensic: forensicFixture({ status: 'GANHA', confidence: 'BAIXA' }) }
    const report = buildForensicLedger(run, [low, ...results.slice(1)])
    expect(report.rows[0].manualReview).toBe(true)
    expect(report.rows[4].manualReview).toBe(true)
  })
})
