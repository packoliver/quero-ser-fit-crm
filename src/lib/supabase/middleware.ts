import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { Database, UserRole } from '@/types/database'

// Todo early-return deste middleware (redirect ou 401 json) precisa levar consigo os
// cookies que o `setAll` do Supabase pode ter acabado de rotacionar (refresh token
// consumido, novo access token emitido) — sem isso, um NextResponse.redirect()/json() novo
// descarta esses cookies silenciosamente, o token novo nunca chega no navegador, e a
// próxima requisição reusa o refresh token já consumido: a sessão morre no meio do
// trabalho, sem aviso nenhum, bem na hora que deveria ter sido renovada. Ver o padrão
// oficial do @supabase/ssr pra middleware Next.js.
function comCookiesRotacionados(response: NextResponse, supabaseResponse: NextResponse): NextResponse {
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie)
  })
  return response
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-url.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const publicRoutes = ['/login', '/recuperar-senha', '/politica-de-privacidade', '/api/webhooks', '/api/push/vapid-public-key']
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))
  const isApiRoute = pathname.startsWith('/api/') && !pathname.startsWith('/api/webhooks')

  // A verified Supabase user is the only valid authentication signal. Cookies,
  // demo flags, and placeholder configuration must never grant access.
  if ((authError || !user) && !isPublicRoute && pathname !== '/') {
    if (isApiRoute) {
      return comCookiesRotacionados(NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }), supabaseResponse)
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return comCookiesRotacionados(NextResponse.redirect(url), supabaseResponse)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/inbox'
    return comCookiesRotacionados(NextResponse.redirect(url), supabaseResponse)
  }

  const isIntegrationsRoute = pathname.startsWith('/configuracoes/integracoes')
  const isEquipeRoute = pathname.startsWith('/configuracoes/equipe')

  if (user && (isIntegrationsRoute || isEquipeRoute)) {
    try {
      const { data: member, error: memberError } = await (supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            eq: (col: string, val: string) => {
              limit: (n: number) => {
                maybeSingle: () => Promise<{ data: { role: UserRole } | null; error: unknown }>
              }
            }
          }
        }
      })
        .from('organization_members')
        .select('role')
        .eq('user_id', user.id)
        // .limit(1) evita PGRST116 (linha ambígua) se o usuário algum dia pertencer a mais
        // de uma organização — sem isso, .maybeSingle() com 2+ linhas volta erro, `role`
        // vira null, e até um admin de verdade era mandado de volta pro Inbox sem
        // explicação nenhuma. Mesmo padrão já usado em team/create-member/route.ts.
        .limit(1)
        .maybeSingle()

      const role = memberError ? null : member?.role || null
      const allowed =
        (isIntegrationsRoute && role === 'admin') ||
        (isEquipeRoute && (role === 'admin' || role === 'manager'))

      if (!allowed) {
        const url = request.nextUrl.clone()
        url.pathname = '/inbox'
        return comCookiesRotacionados(NextResponse.redirect(url), supabaseResponse)
      }
    } catch {
      const url = request.nextUrl.clone()
      url.pathname = '/inbox'
      return comCookiesRotacionados(NextResponse.redirect(url), supabaseResponse)
    }
  }

  return supabaseResponse
}
