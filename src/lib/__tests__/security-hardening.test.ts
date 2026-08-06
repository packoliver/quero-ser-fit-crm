import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { timingSafeEqualString, verifyMetaHmacSignature } from '../security/webhook'
import { getServerEnv, sanitizeSecret } from '../env'

describe('Endurecimento de Segurança - Fase 1.1', () => {
  describe('Comparação Defensiva em Tempo Constante (Timing-Safe)', () => {
    it('deve retornar true para duas strings idênticas', () => {
      const tokenA = 'token_super_seguro_12345'
      const tokenB = 'token_super_seguro_12345'
      expect(timingSafeEqualString(tokenA, tokenB)).toBe(true)
    })

    it('deve retornar false para strings de conteúdos diferentes', () => {
      const tokenA = 'token_super_seguro_12345'
      const tokenB = 'token_super_seguro_12346'
      expect(timingSafeEqualString(tokenA, tokenB)).toBe(false)
    })

    it('deve retornar false com segurança para buffers de tamanhos diferentes sem disparar exceção 500', () => {
      const tokenA = 'token_curto'
      const tokenB = 'token_muito_mais_longo'
      expect(() => timingSafeEqualString(tokenA, tokenB)).not.toThrow()
      expect(timingSafeEqualString(tokenA, tokenB)).toBe(false)
    })

    it('deve retornar false quando um dos valores for nulo ou indefinido', () => {
      expect(timingSafeEqualString(null, 'token')).toBe(false)
      expect(timingSafeEqualString('token', undefined)).toBe(false)
      expect(timingSafeEqualString(null, null)).toBe(false)
    })
  })

  describe('Validação de Assinatura HMAC SHA-256 do Webhook da Meta', () => {
    const appSecret = 'secret_da_meta_para_testes_12345'
    const rawBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })

    it('deve validar com sucesso uma assinatura correta em X-Hub-Signature-256', () => {
      const validSignature = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`
      const isValid = verifyMetaHmacSignature(rawBody, validSignature, appSecret)
      expect(isValid).toBe(true)
    })

    it('deve rejeitar se o corpo da requisição for adulterado', () => {
      const validSignature = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`
      const tamperedBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'malicious' }] })

      const isValid = verifyMetaHmacSignature(tamperedBody, validSignature, appSecret)
      expect(isValid).toBe(false)
    })

    it('deve rejeitar sem disparar erro se a assinatura estiver ausente ou malformatada', () => {
      expect(() => verifyMetaHmacSignature(rawBody, null, appSecret)).not.toThrow()
      expect(verifyMetaHmacSignature(rawBody, null, appSecret)).toBe(false)
      expect(verifyMetaHmacSignature(rawBody, 'sha1=12345', appSecret)).toBe(false)
      expect(verifyMetaHmacSignature(rawBody, 'invalid_header', appSecret)).toBe(false)
    })
  })

  describe('Ambiente Não Bloqueante do Servidor', () => {
    it('deve permitir a inicialização sem quebrar o build se as chaves opcionais da Meta não estiverem presentes', () => {
      const env = getServerEnv()
      expect(env).toBeDefined()
      expect(typeof env).toBe('object')
    })

    it('deve mascarar segredos nos logs sem expor o valor completo', () => {
      expect(sanitizeSecret('super_secret_key_123456789')).not.toContain('secret_key')
      expect(sanitizeSecret(null)).toBe('[NÃO CONFIGURADO]')
    })
  })
})
