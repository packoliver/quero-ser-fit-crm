import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration'

// Fonte self-hosted via next/font (sem custo de rede em runtime, otimizada no build) —
// troca a stack de fontes do sistema por algo com mais identidade visual. font-sans e
// font-mono do Tailwind (ver @theme inline em globals.css) passam a usar essas variáveis
// automaticamente em todo o app, sem precisar tocar em nenhuma página.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})
export const metadata: Metadata = {
  title: 'Quero Ser Fit - CRM',
  description: 'Sistema CRM independente para gestão de atendimento oficial da Quero Ser Fit',
  manifest: '/manifest.json',
  icons: {
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Quero Ser Fit CRM',
  },
}

export const viewport: Viewport = {
  themeColor: '#10b981',
  width: 'device-width',
  initialScale: 1,
  // `viewport-fit=cover` é o que faz env(safe-area-inset-*) devolver valores reais no
  // iPhone. Sem isso o CSS de safe-area existe mas resolve sempre pra 0px, e a barra
  // inferior fica embaixo da barra de gestos do iOS — exatamente o que acontecia aqui.
  viewportFit: 'cover',
  // Com o teclado virtual aberto, encolhe o viewport de layout (o padrão, 'resizes-visual',
  // só encolhe o visual e deixa a página do mesmo tamanho por baixo). É o que mantém o
  // campo de digitar acima do teclado em vez de escondido atrás dele — vale pro app todo,
  // mas quem realmente depende disso é a tela de conversa.
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className="h-full antialiased dark">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-full bg-[#0b1320] text-slate-100 font-sans antialiased`}>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}
