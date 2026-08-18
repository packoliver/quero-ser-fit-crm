import React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
  children: React.ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 active:scale-[0.97] select-none'

  // Cor sólida, não gradiente — botão com degradê de duas cores é um dos sinais mais
  // reconhecíveis de "maquete gerada por IA". Um produto sério usa uma cor confiante só.
  const variantStyles = {
    primary:
      'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-950/40 border border-emerald-400/40',
    secondary:
      'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shadow-sm',
    danger:
      'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-950/40 border border-rose-500/30',
    ghost:
      'bg-transparent hover:bg-slate-800/60 text-slate-400 hover:text-slate-200',
  }

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 gap-1.5',
    md: 'text-xs px-4 py-2.5 gap-2',
    lg: 'text-sm px-5 py-3 gap-2.5',
  }

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
          <span>Carregando...</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}
