'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

interface MobileChromeContextValue {
  /**
   * true quando uma tela pediu o celular inteiro pra si — a barra inferior e o cabeçalho
   * global saem de cena. Não tem efeito nenhum no desktop, onde os dois continuam sempre
   * visíveis (lá o espaço não é disputado).
   */
  immersive: boolean
  setImmersive: (immersive: boolean) => void
}

const MobileChromeContext = createContext<MobileChromeContextValue>({
  immersive: false,
  setImmersive: () => {},
})

export function MobileChromeProvider({ children }: { children: React.ReactNode }) {
  const [immersive, setImmersive] = useState(false)
  const value = useMemo(() => ({ immersive, setImmersive }), [immersive])
  return <MobileChromeContext.Provider value={value}>{children}</MobileChromeContext.Provider>
}

export function useMobileChrome(): MobileChromeContextValue {
  return useContext(MobileChromeContext)
}

/**
 * Entra em modo imersivo no celular enquanto a condição for verdadeira, e sai ao desmontar.
 *
 * Existe pra conversa aberta ocupar a tela inteira, como em qualquer app de mensagem. Sem
 * isso ficam DOIS cabeçalhos empilhados (o global, com logo e sino, e o da própria
 * conversa, com o nome do cliente) mais a barra inferior: ~124px dos 812px do aparelho
 * gastos em navegação que não serve pra nada enquanto se responde alguém — e a barra
 * ainda ficaria espremida entre o campo de digitar e o teclado.
 *
 * A limpeza no return é o que importa: sem ela, sair da conversa por um caminho não
 * previsto (voltar do navegador, tocar numa notificação, trocar de aba) deixaria o app
 * inteiro sem navegação, e sem nenhuma forma óbvia de trazê-la de volta.
 */
export function useImmersiveMobile(immersive: boolean): void {
  const { setImmersive } = useMobileChrome()

  useEffect(() => {
    setImmersive(immersive)
    return () => setImmersive(false)
  }, [immersive, setImmersive])
}
