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
