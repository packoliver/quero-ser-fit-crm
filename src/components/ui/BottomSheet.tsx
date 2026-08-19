'use client'

import React, { useEffect, useRef } from 'react'

export interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  /** Linha de apoio sob o título — ex: o nome do cliente sobre o qual a ação vai agir. */
  description?: string
  children: React.ReactNode
}

/**
 * Painel de ação contextual.
 *
 * No celular sobe de baixo, colado na borda inferior: é onde o polegar já está, e a ação
 * fica perto da mão em vez de no meio da tela. Em telas grandes o mesmo componente vira um
 * painel centralizado — a decisão é só de CSS (`sm:`), sem componente separado nem
 * ramificação em JavaScript, então não existe risco dos dois caminhos divergirem.
 *
 * Diferente do Modal, que é pra formulário/confirmação: aqui a ideia é escolher uma opção
 * numa lista curta e voltar pro que estava fazendo.
 */
export function BottomSheet({ isOpen, onClose, title, description, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)

    // Trava a rolagem do que está atrás: sem isso, arrastar no painel rola a lista de
    // conversas por baixo — no celular isso dá a impressão de que o toque "vazou".
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Foco vai pro painel pra quem usa teclado ou leitor de tela não continuar navegando
    // pelos elementos escondidos atrás.
    panelRef.current?.focus()

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bottom-sheet-title"
        // Clique dentro do painel não pode fechar junto com o clique no fundo.
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#111c30] border-t sm:border border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85dvh] flex flex-col outline-none animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-150 pb-[var(--safe-bottom)] sm:pb-0"
      >
        {/* Alça: só sinaliza "isso aqui é um painel que fecha", padrão que a pessoa já
            reconhece de outros apps. Decorativa — quem fecha de fato é o fundo, o Esc ou
            a própria escolha de uma opção. */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <span className="w-9 h-1 rounded-full bg-slate-700" aria-hidden="true" />
        </div>

        <div className="px-4 pt-2 sm:pt-4 pb-3 shrink-0">
          <h2 id="bottom-sheet-title" className="text-sm font-bold text-slate-100">
            {title}
          </h2>
          {description && <p className="text-xs text-slate-400 mt-0.5 truncate">{description}</p>}
        </div>

        <div className="px-3 pb-3 overflow-y-auto flex-1 min-h-0">{children}</div>
      </div>
    </div>
  )
}

/**
 * Uma linha do painel. Alvo de 48px porque a lista é feita pra ser tocada com o polegar,
 * muitas vezes com o aparelho na mão e o cliente esperando.
 */
export function BottomSheetItem({
  icon,
  label,
  hint,
  selected,
  destructive,
  disabled,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  hint?: string
  selected?: boolean
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={selected ? 'true' : undefined}
      className={`w-full flex items-center gap-3 px-3 min-h-[48px] py-2.5 rounded-xl text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:bg-slate-800 ${
        destructive
          ? 'text-rose-400 hover:bg-rose-950/30 active:bg-rose-950/50'
          : selected
          ? 'bg-slate-800/80 text-emerald-400'
          : 'text-slate-200 hover:bg-slate-800/60 active:bg-slate-800'
      }`}
    >
      {icon && <span className="shrink-0 w-[18px] flex justify-center">{icon}</span>}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 truncate">{hint}</span>}
      </span>
      {/* O estado marcado não pode depender só da cor — quem não distingue verde de cinza
          precisa de outro sinal. */}
      {selected && <span className="shrink-0 text-emerald-400 text-sm leading-none">✓</span>}
    </button>
  )
}
