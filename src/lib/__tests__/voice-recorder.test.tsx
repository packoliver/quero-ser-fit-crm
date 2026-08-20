// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * O que está sendo protegido: descartar uma gravação descarta mesmo.
 *
 * Os dois casos abaixo são bugs que existiram de verdade nesta implementação e que
 * passaram por TypeScript, ESLint e build sem um arranhão — os dois só aparecem no tempo
 * real de quem toca na tela. Um deixava o microfone ligado depois de cancelar; o outro
 * enviava pro cliente um áudio que a pessoa já tinha jogado fora.
 */

const controle = vi.hoisted(() => ({
  resolverPreparo: null as ((arquivo: File) => void) | null,
}))

vi.mock('@/lib/media/audio', async (importarOriginal) => {
  const real = await importarOriginal<typeof import('@/lib/media/audio')>()
  return {
    ...real,
    // Segura o preparo até o teste mandar terminar — é a janela onde o cancelamento
    // durante a conversão precisa ser respeitado.
    prepararParaEnvio: () =>
      new Promise<File>((resolve) => {
        controle.resolverPreparo = resolve
      }),
  }
})

import { useVoiceRecorder } from '@/lib/media/useVoiceRecorder'

let faixaParada = false
let liberarMicrofone: ((faixas: unknown) => void) | null = null

class GravadorFalso {
  static ultimo: GravadorFalso | null = null
  static isTypeSupported = (tipo: string) => tipo === 'audio/mp4;codecs=mp4a.40.2'
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((evento: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_faixas: unknown, opcoes?: { mimeType?: string }) {
    this.mimeType = opcoes?.mimeType || 'audio/mp4'
    GravadorFalso.ultimo = this
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['som'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

function faixasFalsas() {
  return { getTracks: () => [{ stop: () => { faixaParada = true } }] }
}

beforeEach(() => {
  faixaParada = false
  liberarMicrofone = null
  GravadorFalso.ultimo = null
  controle.resolverPreparo = null

  Object.defineProperty(globalThis, 'MediaRecorder', { value: GravadorFalso, configurable: true, writable: true })
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: {
      getUserMedia: () => new Promise((resolve) => { liberarMicrofone = resolve }),
    },
    configurable: true,
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'MediaRecorder')
})

describe('Gravador de voz', () => {
  it('deve entregar o arquivo quando a pessoa encerra normalmente', async () => {
    const onPronto = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder({ onPronto }))

    act(() => result.current.iniciar())
    await act(async () => { liberarMicrofone!(faixasFalsas()) })
    await waitFor(() => expect(result.current.estado).toBe('recording'))

    act(() => result.current.encerrar())
    await waitFor(() => expect(result.current.estado).toBe('processing'))

    const arquivo = new File(['som'], 'audio.m4a', { type: 'audio/mp4' })
    await act(async () => { controle.resolverPreparo!(arquivo) })

    await waitFor(() => expect(onPronto).toHaveBeenCalledWith(arquivo))
    expect(faixaParada).toBe(true)
  })

  it('deve desligar o microfone quando o cancelamento acontece antes da permissão sair', async () => {
    // A ordem que quebrava: toca no microfone, o iOS mostra o alerta, a pessoa desiste e
    // toca em descartar — e só DEPOIS o sistema devolve o microfone liberado.
    const onPronto = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder({ onPronto }))

    act(() => result.current.iniciar())
    await waitFor(() => expect(result.current.estado).toBe('requesting'))

    act(() => result.current.cancelar())
    await act(async () => { liberarMicrofone!(faixasFalsas()) })

    await waitFor(() => expect(result.current.estado).toBe('idle'))
    expect(faixaParada).toBe(true)
    expect(GravadorFalso.ultimo).toBeNull()
    expect(onPronto).not.toHaveBeenCalled()
  })

  it('não deve enviar quando a pessoa descarta durante o preparo do arquivo', async () => {
    const onPronto = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder({ onPronto }))

    act(() => result.current.iniciar())
    await act(async () => { liberarMicrofone!(faixasFalsas()) })
    await waitFor(() => expect(result.current.estado).toBe('recording'))

    act(() => result.current.encerrar())
    await waitFor(() => expect(result.current.estado).toBe('processing'))

    act(() => result.current.cancelar())
    await act(async () => {
      controle.resolverPreparo!(new File(['som'], 'audio.m4a', { type: 'audio/mp4' }))
    })

    await waitFor(() => expect(result.current.estado).toBe('idle'))
    expect(onPronto).not.toHaveBeenCalled()
  })

  it('deve desligar o microfone se a tela for fechada durante a gravação', async () => {
    const { result, unmount } = renderHook(() => useVoiceRecorder({ onPronto: vi.fn() }))

    act(() => result.current.iniciar())
    await act(async () => { liberarMicrofone!(faixasFalsas()) })
    await waitFor(() => expect(result.current.estado).toBe('recording'))

    faixaParada = false
    unmount()
    expect(faixaParada).toBe(true)
  })
})
