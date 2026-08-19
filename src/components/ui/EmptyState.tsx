import React from 'react'

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    // Compacto no celular (p-6) e folgado só a partir do desktop. Tela vazia não merece
    // meia tela de altura: quem chega aqui quer voltar a fazer alguma coisa, não
    // contemplar o aviso de que não tem nada.
    <div
      className={`p-6 lg:p-12 text-center bg-[#0f172a] rounded-2xl border border-slate-800 flex flex-col items-center justify-center space-y-3 ${className}`}
    >
      {icon && (
        <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-2xl bg-slate-800/80 text-emerald-400 flex items-center justify-center border border-slate-700 mb-1">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="text-xs text-slate-400 max-w-sm leading-relaxed">{description}</p>
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}
