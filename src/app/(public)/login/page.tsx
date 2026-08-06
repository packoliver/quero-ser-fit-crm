'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Dumbbell, Lock, Mail, AlertCircle, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react'
import { loginSchema } from '@/lib/validations'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const validation = loginSchema.safeParse({ email, password })
    if (!validation.success) {
      setError(validation.error.issues[0]?.message || 'Dados de login inválidos.')
      return
    }

    setLoading(true)

    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
      const isUnconfigured = !supabaseUrl || supabaseUrl.includes('placeholder')

      if (isUnconfigured || process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true') {
        document.cookie = 'crm_demo_session=true; path=/'
        router.push('/inbox')
        router.refresh()
        return
      }

      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        // Se houver falha de rede/conexão com Supabase não configurado localmente
        if (
          signInError.message.includes('FetchError') ||
          signInError.message.includes('Failed to fetch') ||
          signInError.message.includes('NetworkError')
        ) {
          document.cookie = 'crm_demo_session=true; path=/'
          router.push('/inbox')
          router.refresh()
          return
        }

        if (signInError.message.includes('Invalid login credentials')) {
          setError('E-mail ou senha incorretos. Por favor, verifique suas credenciais.')
        } else if (signInError.message.includes('Email not confirmed')) {
          setError('Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.')
        } else {
          setError('Não foi possível realizar o login no momento. Verifique seus dados ou tente mais tarde.')
        }
        setLoading(false)
        return
      }

      router.push('/inbox')
      router.refresh()
    } catch {
      document.cookie = 'crm_demo_session=true; path=/'
      router.push('/inbox')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const handleDemoFill = (demoEmail: string) => {
    setEmail(demoEmail)
    setPassword('senha123')
    document.cookie = 'crm_demo_session=true; path=/'
    router.push('/inbox')
    router.refresh()
  }

  return (
    <div className="w-full max-w-md bg-[#111c30] border border-slate-800 rounded-2xl p-8 shadow-2xl relative z-10 my-8">
      {/* Brand Logo */}
      <div className="flex flex-col items-center mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-xl shadow-emerald-950/50 mb-3">
          <Dumbbell className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Quero Ser Fit</h1>
        <p className="text-sm text-slate-400 mt-1">CRM de Atendimento Independente</p>
      </div>

      {/* Error Notification */}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Login Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="E-mail Corporativo"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@queroserfit.com.br"
          icon={<Mail className="w-4 h-4" />}
          required
        />

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Senha de Acesso
            </label>
            <Link
              href="/recuperar-senha"
              className="text-xs text-emerald-400 hover:underline hover:text-emerald-300 transition"
            >
              Esqueceu a senha?
            </Link>
          </div>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            icon={<Lock className="w-4 h-4" />}
            required
          />
        </div>

        <Button type="submit" isLoading={loading} className="w-full mt-2" size="lg">
          <span>Entrar no CRM</span>
          <ArrowRight className="w-4 h-4" />
        </Button>
      </form>

      {/* Demo pre-filled buttons */}
      <div className="mt-8 pt-6 border-t border-slate-800 text-center">
        <p className="text-xs text-slate-400 mb-3 font-medium flex items-center justify-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>Contas de demonstração rápida:</span>
        </p>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => handleDemoFill('admin@queroserfit.com.br')}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 flex flex-col items-center gap-1 transition"
          >
            <span className="font-semibold text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Admin
            </span>
            <span className="text-[10px] text-slate-400 truncate max-w-full">admin@queroserfit.com.br</span>
          </button>

          <button
            type="button"
            onClick={() => handleDemoFill('atendente@queroserfit.com.br')}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 flex flex-col items-center gap-1 transition"
          >
            <span className="font-semibold text-teal-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Atendente
            </span>
            <span className="text-[10px] text-slate-400 truncate max-w-full">atendente@queroserfit.com.br</span>
          </button>
        </div>
      </div>
    </div>
  )
}
