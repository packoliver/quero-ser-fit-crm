import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * Interruptor de manutenção — pedido pelo Patrick em 24/08/2026: pausar o uso do CRM por
 * tempo indeterminado, sem mexer no banco (as mensagens de WhatsApp/Instagram precisam
 * continuar chegando e sendo guardadas normalmente, só ninguém consegue abrir a tela
 * enquanto estiver assim).
 *
 * Pra voltar a usar: troque para `false` e faça o deploy de novo. Nada além desta
 * constante precisa mudar.
 */
const MANUTENCAO_ATIVA = true

function paginaDeManutencao(): NextResponse {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quero Ser Fit CRM — Indisponível</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #0b1320;
    color: #e2e8f0;
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  .card {
    max-width: 420px;
    text-align: center;
  }
  .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: #64748b;
    margin: 0 auto 20px;
  }
  h1 { font-size: 1.25rem; font-weight: 700; margin: 0 0 12px; color: #f1f5f9; }
  p { font-size: 0.9rem; line-height: 1.6; color: #94a3b8; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="dot"></div>
    <h1>CRM temporariamente indisponível</h1>
    <p>O sistema está fora do ar por enquanto. Mensagens de WhatsApp e Instagram continuam sendo recebidas normalmente.</p>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Sem prazo real pra voltar (pedido foi "por tempo indeterminado") — um valor alto
      // evita que ferramentas de monitoramento fiquem batendo com frequência à toa.
      'retry-after': '86400',
    },
  })
}

export async function proxy(request: NextRequest) {
  // Webhooks continuam passando direto (sem checar sessão, igual já era) — é o que recebe
  // mensagem nova do WhatsApp/Instagram, e isso não pode parar mesmo com o CRM pausado.
  const isWebhook = request.nextUrl.pathname.startsWith('/api/webhooks')
  if (MANUTENCAO_ATIVA && !isWebhook) {
    return paginaDeManutencao()
  }
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - ffmpeg/ (motor de compressão de vídeo — arquivo estático, ver
     *   scripts/copy-ffmpeg-core.js; precisa ser buscável mesmo antes/sem sessão
     *   totalmente resolvida, e não tem por que passar pela checagem de auth)
     * - public assets (svg, png, jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|offline.html|ffmpeg/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
