'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getMobilePrimaryNavItems, getMoreNavItems, MORE_NAV_ITEM, type NavItem } from '@/lib/navigation'
import { UserRole } from '@/types/database'

export interface MobileBottomNavProps {
  userRole?: UserRole
}

export function MobileBottomNav({ userRole = 'admin' }: MobileBottomNavProps) {
  const pathname = usePathname()

  if (pathname === '/login' || pathname === '/recuperar-senha') {
    return null
  }

  const primaryItems = getMobilePrimaryNavItems(userRole)
  // "Mais" fica aceso enquanto o usuário estiver em qualquer tela que mora lá dentro
  // (Clientes, Relatórios, Configurações...), não só na listagem /mais — senão a barra
  // não indica onde a pessoa está assim que ela entra em uma delas.
  const moreHrefs = getMoreNavItems(userRole).map((item) => item.href)
  const moreIsActive =
    pathname === MORE_NAV_ITEM.href || moreHrefs.some((href) => pathname === href || pathname.startsWith(`${href}/`))

  const items: Array<{ item: NavItem; isActive: boolean }> = [
    ...primaryItems.map((item) => ({
      item,
      isActive: pathname === item.href || pathname.startsWith(`${item.href}/`),
    })),
    { item: MORE_NAV_ITEM, isActive: moreIsActive },
  ]

  return (
    <nav
      aria-label="Navegação principal"
      // pb com calc(): o padding normal MAIS o recorte do aparelho (ver --safe-bottom em
      // globals.css). Somado num valor só de propósito — duas classes de padding-bottom
      // disputando dependeriam da ordem em que o Tailwind as emite.
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0f172a]/95 backdrop-blur-md border-t border-slate-800 pt-1.5 pb-[calc(0.375rem+var(--safe-bottom))] pl-[calc(0.25rem+var(--safe-left))] pr-[calc(0.25rem+var(--safe-right))] select-none"
    >
      <div className="flex items-stretch">
        {items.map(({ item, isActive }) => {
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              // min-h-[44px] é o alvo mínimo de toque recomendado — antes cada item ficava
              // com o tamanho que sobrasse depois de dividir a largura por 13.
              className={`flex-1 min-w-0 min-h-[44px] flex flex-col items-center justify-center gap-0.5 py-1 rounded-lg text-[11px] font-medium transition-colors active:scale-95 ${
                isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className={`truncate max-w-full px-0.5 ${isActive ? 'font-semibold' : ''}`}>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
