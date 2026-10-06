import { describe, expect, it } from 'vitest'
import { ownedMediaPath, imageMime, validateImageDescription } from '../audit-media'
import { calculateAuditCoverage, validateAuditAnalysis, type AuditMessage } from '../audit-model'
import { groupLossReasons, isInInsightPeriod } from '../insight-view'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const host = 'https://example.supabase.co'
const message: AuditMessage = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sender_type: 'contact', sender_id: null,
  content: null, media_url: `${host}/storage/v1/object/public/chat-media/${org}/audio.ogg`, media_type: 'audio', created_at: '2026-08-10',
  mediaInterpretation: { kind: 'audio_transcript', state: 'interpreted', text: 'Quero comprar a calça azul.', limitations: [] } }
describe('Mídias e indicadores da auditoria', () => {
  it('não contabiliza falta de acesso à imagem como interpretação', () => {
    expect(() => validateImageDescription({ imageAccessible: false, description: 'Não consigo acessar a imagem.', limitations: [] })).toThrow()
    expect(() => validateImageDescription({ imageAccessible: true, description: 'Não posso ver a imagem.', limitations: [] })).toThrow()
    expect(validateImageDescription({ imageAccessible: true, description: 'Calça azul com etiqueta de tamanho M.', limitations: [] }).description).toContain('Calça azul')
  })
  it('aceita apenas o arquivo da própria organização no Storage conhecido', () => {
    expect(ownedMediaPath(message.media_url!, org, host)).toBe(`${org}/audio.ogg`)
    for (const url of ['http://127.0.0.1/audio', `${host}/storage/v1/object/public/chat-media/other/audio.ogg`, 'https://evil.test/file']) {
      expect(() => ownedMediaPath(url, org, host)).toThrow()
    }
  })
  it('confere bytes da imagem em vez de confiar na extensão', () => {
    expect(imageMime(Buffer.from('%PDF fake.jpg'))).toBeNull()
    expect(imageMime(Buffer.from([255,216,255,0]))).toBe('image/jpeg')
  })
  it('valida citação de áudio na transcrição e não a apresenta como texto original', () => {
    const analysis = { status: 'ok', outcome: 'aberta', summary: 'Pedido de calça.', outcomeReason: null, lossCategory: null,
      findings: [{ type: 'pendencia', description: 'Responder ao pedido.', confidence: 'alta',
        evidence: [{ messageId: message.id, source: 'audio_transcript', quote: 'calça azul' }] }] }
    expect(validateAuditAnalysis(analysis, [message]).findings).toHaveLength(1)
    analysis.findings[0].evidence[0].source = 'text'
    expect(() => validateAuditAnalysis(analysis, [message])).toThrow()
  })
  it('aceita ressalva literal da mídia e rejeita ressalva inventada', () => {
    const image = { ...message, media_type: 'image', mediaInterpretation: { kind: 'image_description' as const,
      state: 'limited' as const, text: 'Peça cinza com etiqueta.', limitations: ['O texto da etiqueta é ilegível.'] } }
    const analysis = { status: 'ok', outcome: 'aberta', summary: 'Tamanho não verificável.', outcomeReason: null, lossCategory: null,
      findings: [{ type: 'pendencia', description: 'Conferir etiqueta.', confidence: 'baixa',
        evidence: [{ messageId: image.id, source: 'image_description', quote: 'O texto da etiqueta é ilegível.' }] }] }
    expect(validateAuditAnalysis(analysis, [image]).findings).toHaveLength(1)
    analysis.findings[0].evidence[0].quote = 'Tamanho confirmado G'
    expect(() => validateAuditAnalysis(analysis, [image])).toThrow()
  })
  it('distingue interpretação completa, incerta e anexo sem leitura', () => {
    const uncertain = { ...message, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', mediaInterpretation: { ...message.mediaInterpretation!, state: 'limited' as const } }
    const unsupported = { ...message, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', media_type: 'video', mediaInterpretation: undefined }
    expect(calculateAuditCoverage([message, uncertain, unsupported])).toMatchObject({ messages: 3, mediaInterpreted: 1, mediaLimited: 1, mediaUntranscribed: 2, audioTranscribed: 2 })
  })
  it('reanalisar hoje não muda a data comercial da conversa antiga', () => {
    const asOf = Date.parse('2026-10-05T00:00:00Z')
    expect(isInInsightPeriod('2026-08-10T00:00:00Z', 30, asOf)).toBe(false)
    expect(isInInsightPeriod('2026-10-01T00:00:00Z', 30, asOf)).toBe(true)
    expect(isInInsightPeriod('2026-10-06T00:00:00Z', 30, asOf)).toBe(false)
  })
  it('agrupa redações diferentes do mesmo motivo e conta perda sem motivo', () => {
    expect(groupLossReasons([{ outcomeReason: 'Cliente sumiu sem responder após os preços.' },
      { outcomeReason: 'Cliente sem retorno — Após a proposta.' }, { outcomeReason: null }])).toEqual([
      ['Cliente sem retorno', 2], ['Motivo não identificado', 1],
    ])
  })
})
