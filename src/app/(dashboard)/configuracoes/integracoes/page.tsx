'use client'

import { Phone, ShieldCheck, Info, Sparkles, AlertCircle } from 'lucide-react'
import { InstagramIcon as Instagram } from '@/components/icons/InstagramIcon'
import { demoIntegrations } from '@/lib/demo'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'

export default function IntegracoesConfigPage() {
  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-100">Integrações do CRM</h1>
          <Badge variant="emerald" icon={<Sparkles className="w-3 h-3" />}>
            Estrutura Preparada
          </Badge>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Conectores oficiais da Meta (WhatsApp & Instagram) e sistemas futuros (PontuaMax).
        </p>
      </div>

      {/* Scope Decision Notice */}
      <div className="p-4 bg-emerald-950/40 border border-emerald-800/60 rounded-2xl text-xs space-y-2 text-emerald-300">
        <div className="flex items-center gap-2 font-bold text-emerald-200">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <span>Status das Integrações Externa (Fase Atual)</span>
        </div>
        <p className="leading-relaxed text-emerald-300/90">
          Todas as integrações externas ativas serão configuradas exclusivamente na última fase do projeto. Nesta fase, não há conexões externas com WhatsApp, Instagram ou PontuaMax. As estruturas de webhook e conectores defensivos estão totalmente preparadas.
        </p>
      </div>

      {/* Connectors Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {demoIntegrations.map((integ) => (
          <Card key={integ.id} className="flex flex-col justify-between">
            <CardHeader className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-2.5 rounded-xl bg-slate-800 text-emerald-400 border border-slate-700">
                  {integ.provider === 'whatsapp_meta' ? (
                    <Phone className="w-5 h-5" />
                  ) : integ.provider === 'instagram_meta' ? (
                    <Instagram className="w-5 h-5 text-pink-400" />
                  ) : (
                    <Sparkles className="w-5 h-5 text-amber-400" />
                  )}
                </div>
                <Badge variant="amber" icon={<AlertCircle className="w-3 h-3" />}>
                  Não Configurado
                </Badge>
              </div>

              <div>
                <h2 className="text-sm font-bold text-slate-100">{integ.name}</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{integ.description}</p>
              </div>
            </CardHeader>

            <CardBody className="bg-slate-950/40 border-t border-slate-800 text-xs">
              <div className="flex justify-between items-center text-[11px] text-slate-400">
                <span>Disponibilidade:</span>
                <span className="font-semibold text-emerald-400">{integ.releasePhase}</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Webhook Endpoint Info Box */}
      <Card className="p-5 text-xs space-y-3">
        <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
          <Info className="w-4 h-4 text-emerald-400" />
          <span>Estrutura de Webhook Preparada</span>
        </h3>
        <p className="text-slate-400 leading-relaxed">
          O endpoint de recebimento defensivo está compilado e pronto para responder às chamadas de verificação quando a fase de integrações for iniciada:
        </p>

        <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono space-y-1 text-[11px]">
          <div className="text-slate-400">
            <strong className="text-emerald-400">Endpoint Webhook:</strong> /api/webhooks/meta
          </div>
          <div className="text-slate-400">
            <strong className="text-emerald-400">Segurança:</strong> HMAC SHA-256 (X-Hub-Signature-256)
          </div>
        </div>
      </Card>
    </div>
  )
}
