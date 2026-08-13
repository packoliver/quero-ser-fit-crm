import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { Database, UserRole } from '@/types/database'

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
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/inbox'
    return NextResponse.redirect(url)
  }

  const isIntegrationsRoute = pathname.startsWith('/configuracoes/integracoes')
  const isEquipeRoute = pathname.startsWith('/configuracoes/equipe')

  if (user && (isIntegrationsRoute || isEquipeRoute)) {
    try {
      const { data: member, error: memberError } = await (supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: { role: UserRole } | null; error: unknown }>
            }
          }
        }
      })
        .from('organization_members')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()

      const role = memberError ? null : member?.role || null
      const allowed =
        (isIntegrationsRoute && role === 'admin') ||
        (isEquipeRoute && (role === 'admin' || role === 'manager'))

      if (!allowed) {
        const url = request.nextUrl.clone()
        url.pathname = '/inbox'
        return NextResponse.redirect(url)
      }
    } catch {
      const url = request.nextUrl.clone()
      url.pathname = '/inbox'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
