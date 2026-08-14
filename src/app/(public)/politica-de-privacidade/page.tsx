import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de Privacidade | Quero Ser Fit CRM',
  description: 'Política de privacidade do Quero Ser Fit CRM.',
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-200">
      <article className="mx-auto max-w-3xl space-y-8 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-white">Política de Privacidade</h1>
          <p className="text-sm text-slate-400">Última atualização: 13 de agosto de 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">1. Sobre o serviço</h2>
          <p>
            O Quero Ser Fit CRM é uma ferramenta de gestão de atendimento usada pela Quero Ser Fit.
            Ela pode integrar canais oficiais de comunicação, incluindo Instagram e WhatsApp, para
            organizar conversas e permitir que a equipe responda aos clientes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">2. Dados tratados</h2>
          <p>
            O serviço pode tratar nome, identificadores de conta, mensagens, anexos, datas e dados
            técnicos necessários para autenticação, segurança, atendimento e funcionamento das integrações.
            Não vendemos dados pessoais.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">3. Uso e armazenamento</h2>
          <p>
            Usamos os dados para exibir e organizar atendimentos, enviar respostas solicitadas pela
            equipe autorizada, manter a segurança da conta e cumprir obrigações legais. Os dados são
            armazenados em serviços de infraestrutura contratados, com controles de acesso e isolamento
            por organização.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">4. Integrações com a Meta</h2>
          <p>
            Quando uma conta do Instagram é conectada, o serviço usa as permissões autorizadas pelo
            administrador para receber e responder mensagens. O usuário pode remover essa autorização
            a qualquer momento nas configurações da Meta ou desconectar a integração no CRM.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">5. Exclusão e contato</h2>
          <p>
            Para solicitar acesso, correção ou exclusão de dados, entre em contato pelo e-mail
            comercial@queroserfit.com. Atenderemos solicitações legítimas dentro dos prazos legais aplicáveis.
          </p>
        </section>
      </article>
    </main>
  )
}
