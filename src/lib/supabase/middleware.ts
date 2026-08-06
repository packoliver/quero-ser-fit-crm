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
  } = await supabase.auth.getUser()

  const isUnconfiguredSupabase =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder') ||
    process.env.NEXT_PUBLIC_SUPABASE_URL === ''

  const isDemoSession =
    request.cookies.get('crm_demo_session')?.value === 'true' ||
    process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' ||
    isUnconfiguredSupabase

  const pathname = request.nextUrl.pathname
  const publicRoutes = ['/login', '/recuperar-senha', '/api/webhooks']
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))

  // Protection 1: Unauthenticated user accessing protected dashboard routes
  if (!user && !isDemoSession && !isPublicRoute && pathname !== '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Protection 2: Authenticated user accessing login page
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/inbox'
    return NextResponse.redirect(url)
  }

  // Protection 3: Role-based URL protection for admin & manager routes
  const isIntegrationsRoute = pathname.startsWith('/configuracoes/integracoes')
  const isEquipeRoute = pathname.startsWith('/configuracoes/equipe')

  if (user && (isIntegrationsRoute || isEquipeRoute)) {
    const { data: member } = await (supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            single: () => Promise<{ data: { role: UserRole } | null }>
          }
        }
      }
    })
      .from('organization_members')
      .select('role')
      .eq('user_id', user.id)
      .single()

    const role = member?.role || 'attendant'

    if (isIntegrationsRoute && role !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/inbox'
      return NextResponse.redirect(url)
    }

    if (isEquipeRoute && role !== 'admin' && role !== 'manager') {
      const url = request.nextUrl.clone()
      url.pathname = '/inbox'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
