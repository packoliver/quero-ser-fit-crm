import React from 'react'

export interface BadgeProps {
  variant?: 'emerald' | 'teal' | 'amber' | 'rose' | 'slate' | 'pink' | 'indigo'
  children: React.ReactNode
  className?: string
  icon?: React.ReactNode
}

export function Badge({
  variant = 'emerald',
  children,
  className = '',
  icon,
}: BadgeProps) {
  const variantStyles = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    teal: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    slate: 'bg-slate-800 text-slate-300 border-slate-700',
    pink: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${variantStyles[variant]} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  )
}
