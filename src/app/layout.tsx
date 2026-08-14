import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration'
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
      <body className="min-h-full bg-[#0b1320] text-slate-100 font-sans">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}
