import React from 'react'
import { CheckCircle2 } from 'lucide-react'

export interface ToastProps {
  /** Texto da confirmação. Quando null/vazio, nada é renderizado. */
  message: string | null
  /** Ícone à esquerda. O padrão serve pro caso comum: "deu certo". */
  icon?: React.ReactNode
}

/**
 * Confirmação passageira de que uma ação deu certo.
 *
 * Fica embaixo e centralizado no celular, acima da barra de navegação: é onde o olho já
 * está depois de tocar em alguma coisa, e não cobre o cabeçalho. Em telas grandes volta pro
 * canto superior direito, longe de onde se trabalha.
 *
 * Entra deslizando de leve e para. A versão anterior usava `animate-bounce`, que fica
 * pulando pelos 3,5 segundos inteiros — chama atenção muito além do que a informação
 * merece e é o tipo de movimento que faz um produto parecer maquete.
 */
export function Toast({ message, icon }: ToastProps) {
  if (!message) return null

  return (
    <div
      // aria-live="polite" pra leitor de tela anunciar quando aparecer, sem interromper o
      // que a pessoa estiver fazendo. Sem isso a confirmação simplesmente não existe pra quem
      // não está olhando pra tela.
      role="status"
      aria-live="polite"
      className="fixed z-50 bottom-[calc(var(--bottom-nav-h)+0.75rem)] left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm lg:bottom-auto lg:left-auto lg:translate-x-0 lg:top-6 lg:right-6 lg:w-auto bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-2xl border border-emerald-400/30 flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 lg:slide-in-from-top-2 duration-200"
    >
      <span className="shrink-0 text-emerald-100">{icon ?? <CheckCircle2 className="w-4 h-4" />}</span>
      <span className="min-w-0">{message}</span>
    </div>
  )
}
