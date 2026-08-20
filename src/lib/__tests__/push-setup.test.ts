import { describe, it, expect, afterEach } from 'vitest'
import { subscribeToPush, pushSetupMessage, type PushFailureReason } from '@/lib/pwa/subscribe'

/**
 * O que está sendo protegido aqui é o diagnóstico, não o envio.
 *
 * Notificação web no iPhone tem uma pegadinha que não aparece em nenhum outro lugar: só
 * funciona com o app adicionado à tela de início. Aberto numa aba do Safari, `PushManager`
 * nem existe. Antes disso o app respondia "não foi possível ativar neste dispositivo" —
 * verdadeiro e completamente inútil, porque o aparelho era capaz o tempo todo.
 */

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126'

/** Monta um `window`/`navigator` mínimo — o ambiente de teste é node, não tem nenhum dos dois. */
function simularAparelho(opcoes: { userAgent: string; instalado: boolean; temPushManager: boolean }) {
  const janela: Record<string, unknown> = {
    Notification: {},
    matchMedia: () => ({ matches: opcoes.instalado }),
    navigator: { standalone: opcoes.instalado },
  }
  if (opcoes.temPushManager) janela.PushManager = {}

  Object.defineProperty(globalThis, 'window', { value: janela, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: opcoes.userAgent, maxTouchPoints: 5, serviceWorker: {} },
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'navigator')
})

describe('Ativar notificações — motivo da falha', () => {
  it('deve dizer que falta instalar quando é iPhone aberto no Safari', async () => {
    simularAparelho({ userAgent: IPHONE, instalado: false, temPushManager: false })
    const resultado = await subscribeToPush()
    expect(resultado).toEqual({ ok: false, reason: 'nao-instalado' })
    expect(pushSetupMessage('nao-instalado')).toContain('tela de início')
  })

  it('deve dizer que o aparelho não tem suporte quando já está instalado e mesmo assim falta PushManager', async () => {
    // É o iPhone com iOS anterior ao 16.4: instalar na tela de início não resolve, e
    // mandar a pessoa instalar de novo seria mentira.
    simularAparelho({ userAgent: IPHONE, instalado: true, temPushManager: false })
    expect(await subscribeToPush()).toEqual({ ok: false, reason: 'sem-suporte' })
  })

  it('não deve mandar instalar em aparelho que não é da Apple', async () => {
    // Android sem PushManager é navegador sem suporte, não app fora da tela de início.
    simularAparelho({ userAgent: ANDROID, instalado: false, temPushManager: false })
    expect(await subscribeToPush()).toEqual({ ok: false, reason: 'sem-suporte' })
  })

  it('deve ter texto próprio e não vazio para cada motivo', () => {
    const motivos: PushFailureReason[] = [
      'sem-suporte',
      'nao-instalado',
      'permissao-negada',
      'servidor-sem-chave',
      'falhou',
    ]
    const textos = motivos.map(pushSetupMessage)
    expect(textos.every((t) => t.length > 0)).toBe(true)
    expect(new Set(textos).size).toBe(motivos.length)
  })
})
