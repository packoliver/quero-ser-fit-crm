// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { getEnterToSend, setEnterToSend, useEnterToSend } from '@/lib/preferences/composer'

describe('Preferência "Enter envia a mensagem" (localStorage do aparelho, não o banco)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('deve começar ligada (Enter envia) quando a pessoa nunca escolheu nada, pra não mudar o hábito de ninguém', () => {
    expect(getEnterToSend()).toBe(true)
  })

  it('deve persistir a troca no localStorage e refletir na próxima leitura', () => {
    setEnterToSend(false)
    expect(getEnterToSend()).toBe(false)

    setEnterToSend(true)
    expect(getEnterToSend()).toBe(true)
  })

  it('deve avisar quem está com o hook montado quando a preferência muda em outro lugar (ex: outra aba)', () => {
    const { result } = renderHook(() => useEnterToSend())
    expect(result.current[0]).toBe(true)

    // Muda "por fora" do hook (ex: outra aba escrevendo e emitindo o mesmo aviso) — o
    // ponto é que useSyncExternalStore reage a QUALQUER chamada de setEnterToSend, não só
    // à do próprio setter devolvido pelo hook.
    act(() => {
      setEnterToSend(false)
    })
    expect(result.current[0]).toBe(false)
  })

  it('o setter devolvido pelo hook também persiste e atualiza o próprio hook', () => {
    const { result } = renderHook(() => useEnterToSend())

    act(() => {
      result.current[1](false)
    })

    expect(result.current[0]).toBe(false)
    expect(getEnterToSend()).toBe(false)
  })
})
