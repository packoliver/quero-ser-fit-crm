import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { getServerEnv } from '@/lib/env'

const ALGORITHM = 'aes-256-gcm'

function getEncryptionKey(): Buffer {
  const env = getServerEnv()
  const isProduction = process.env.NODE_ENV === 'production'
  const keyString = env.INTEGRATION_ENCRYPTION_KEY || (isProduction ? '' : '12345678901234567890123456789012')

  if (!keyString) {
    throw new Error(
      'FALHA CRÍTICA DE SEGURANÇA: A variável INTEGRATION_ENCRYPTION_KEY precisa ser configurada no ambiente para realizar criptografia.'
    )
  }

  return Buffer.from(keyString.padEnd(32, '0').slice(0, 32), 'utf8')
}

export function encryptToken(text: string): string {
  const iv = randomBytes(16)
  const key = getEncryptionKey()
  const cipher = createCipheriv(ALGORITHM, key, iv)
  
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  
  // Format: iv:authTag:encryptedPayload
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

export function decryptToken(encryptedData: string): string {
  const parts = encryptedData.split(':')
  if (parts.length !== 3) {
    throw new Error('Formato de token criptografado inválido')
  }

  const [ivHex, authTagHex, encryptedText] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const key = getEncryptionKey()
  
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  
  return decrypted
}
