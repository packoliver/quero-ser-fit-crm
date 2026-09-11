'use client'

import { Keyboard } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { useEnterToSend } from '@/lib/preferences/composer'

export default function PreferenciasPage() {
  const [enterToSend, setEnterToSend] = useEnterToSend()

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Keyboard className="w-5 h-5 text-emerald-400" />
          Preferências
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Ajustes de digitação salvos só neste aparelho — cada pessoa pode configurar do seu jeito, sem afetar o
          time.
        </p>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Enter envia a mensagem</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {enterToSend
                ? 'Ligado: apertar Enter envia a mensagem. Shift+Enter continua pulando linha.'
                : 'Desligado: Enter só pula linha, igual no WhatsApp. Pra enviar, clique no botão de enviar.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnterToSend(!enterToSend)}
            role="switch"
            aria-checked={enterToSend}
            className={`relative w-11 h-6 rounded-full transition shrink-0 ${enterToSend ? 'bg-emerald-600' : 'bg-slate-700'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enterToSend ? 'translate-x-5' : ''}`}
            />
          </button>
        </CardHeader>
      </Card>
    </div>
  )
}
