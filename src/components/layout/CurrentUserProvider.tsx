'use client'

import { createContext, useContext } from 'react'
import { UserRole } from '@/types/database'

export interface CurrentUserContextValue {
  /** Cargo em vigor. Fora de uma sessão real é o cargo simulado do seletor do Header. */
  role: UserRole
  /** Dados de verdade do usuário logado — null no modo de demonstração local. */
  user: { fullName: string; email: string } | null
  /** true quando há sessão Supabase de verdade por trás (e não o modo simulado). */
  isRealSession: boolean
}

// O default repete o mesmo "falha pro lado seguro" do (dashboard)/layout.tsx: se algum dia
// um componente for renderizado fora do provider, ele enxerga o cargo MENOS privilegiado
// em vez do mais. Isso é só pra UI não piscar opção que a pessoa não pode usar — a barreira
// de verdade continua sendo o RLS no banco, que não conhece esse contexto.
const CurrentUserContext = createContext<CurrentUserContextValue>({
  role: 'attendant',
  user: null,
  isRealSession: false,
})

export function CurrentUserProvider({
  value,
  children,
}: {
  value: CurrentUserContextValue
  children: React.ReactNode
}) {
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>
}

/** Cargo/usuário resolvidos uma vez no layout do dashboard, sem refazer a consulta por página. */
export function useCurrentUser(): CurrentUserContextValue {
  return useContext(CurrentUserContext)
}
