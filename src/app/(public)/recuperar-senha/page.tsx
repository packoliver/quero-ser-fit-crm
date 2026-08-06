'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Dumbbell, Mail, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react'
import { recoverPasswordSchema } from '@/lib/validations'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'

export default function RecoverPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const validation = recoverPasswordSchema.safeParse({ email })
    if (!validation.success) {
      setError(validation.error.issues[0]?.message || 'E-mail inválido.')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      })

      if (resetError) {
        setError('Não foi possível enviar o e-mail de redefinição. Verifique o endereço informado.')
        setLoading(false)
        return
      }

      setSubmitted(true)
    } catch {
      setSubmitted(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md bg-[#111c30] border border-slate-800 rounded-2xl p-8 shadow-2xl relative z-10 my-8">
      <div className="flex flex-col items-center mb-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-xl mb-3">
          <Dumbbell className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-100">Recuperação de Senha</h1>
        <p className="text-xs text-slate-400 mt-1">
          Informe seu e-mail cadastrado para receber as instruções de redefinição.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {submitted ? (
        <div className="text-center py-4 space-y-4">
          <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">Instruções enviadas!</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Se o e-mail <span className="font-semibold text-slate-300">{email}</span> estiver cadastrado no CRM, você receberá um link de recuperação em instantes.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-xs text-emerald-400 hover:underline pt-2 font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar para o Login</span>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="E-mail Cadastrado"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="atendimento@queroserfit.com.br"
            icon={<Mail className="w-4 h-4" />}
            required
          />

          <Button type="submit" isLoading={loading} className="w-full" size="lg">
            Enviar Instruções
          </Button>

          <div className="text-center pt-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar para o login</span>
            </Link>
          </div>
        </form>
      )}
    </div>
  )
}
