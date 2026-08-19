'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, LogOut } from 'lucide-react'
import { getMoreNavItems, type NavItem } from '@/lib/navigation'
import { useCurrentUser } from '@/components/layout/CurrentUserProvider'
import { signOutEverywhere } from '@/lib/auth-client'

/** Separa o que é operação do dia a dia do que é ajuste de sistema, pela própria rota —
 * assim uma tela nova em /configuracoes cai no grupo certo sozinha, sem lista pra manter. */
function splitByArea(items: NavItem[]): { operacao: NavItem[]; ajustes: NavItem[] } {
  return {
    operacao: items.filter((item) => !item.href.startsWith('/configuracoes')),
    ajustes: items.filter((item) => item.href.startsWith('/configuracoes')),
  }
}

function NavGroup({ title, items }: { title: string; items: NavItem[] }) {
  if (items.length === 0) return null

  return (
    <section>
      <h2 className="px-1 pb-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{title}</h2>
      {/* Lista corrida com divisórias, e não um card por item: são poucos itens, lidos de
          relance, e uma grade de cartõezinhos só aumentaria a rolagem sem dizer mais nada. */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-800/80">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-4 min-h-[52px] py-3 text-slate-200 hover:bg-slate-800/50 active:bg-slate-800 transition-colors focus:outline-none focus-visible:bg-slate-800/60"
            >
              <Icon className="w-[18px] h-[18px] text-slate-400 shrink-0" />
              <span className="flex-1 text-sm font-medium truncate">{item.label}</span>
              <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
            </Link>
          )
        })}
      </div>
    </section>
  )
}

export default function MaisPage() {
  const router = useRouter()
  const { role, user } = useCurrentUser()
  const { operacao, ajustes } = splitByArea(getMoreNavItems(role))

  const handleLogout = async () => {
    await signOutEverywhere()
    router.push('/login')
    router.refresh()
  }

  const roleLabel = role === 'admin' ? 'Administrador' : role === 'manager' ? 'Gerente' : 'Atendente'

  return (
    // Só no celular: no desktop a barra lateral já lista tudo isso, então quem chega aqui
    // por link direto vê a mesma lista sem que ela vire uma "segunda navegação" concorrente.
    <div className="p-4 lg:p-8 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Mais</h1>
        <p className="text-xs text-slate-400 mt-1">
          {user ? `${user.fullName} · ${roleLabel}` : roleLabel}
        </p>
      </div>

      <NavGroup title="Atendimento" items={operacao} />
      <NavGroup title="Configurações" items={ajustes} />

      <section>
        <h2 className="px-1 pb-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Conta</h2>
        <div className="bg-[#0f172a] border border-slate-800 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 min-h-[52px] py-3 text-rose-400 hover:bg-rose-950/30 active:bg-rose-950/50 transition-colors focus:outline-none focus-visible:bg-rose-950/40"
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" />
            <span className="flex-1 text-left text-sm font-medium">Sair da conta</span>
          </button>
        </div>
      </section>
    </div>
  )
}
