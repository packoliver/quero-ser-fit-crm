/**
 * Bolinha com número no ícone do app na tela de início — a mesma ideia da do WhatsApp.
 *
 * Só existe em app instalado: iPhone com iOS 16.4 ou mais novo (adicionado à tela de
 * início, não aberto pelo Safari) e Android via Chrome. Em navegador comum a API
 * simplesmente não existe, e as funções aqui não fazem nada.
 *
 * O TypeScript declara `setAppBadge` como se sempre existisse (lib.dom.d.ts), então a
 * checagem em tempo de execução abaixo não é redundância — é o que impede um TypeError
 * no Safari antigo e no Firefox.
 */
function badgeApi(): Navigator | null {
  if (typeof navigator === 'undefined') return null
  if (typeof navigator.setAppBadge !== 'function') return null
  return navigator
}

/** Escreve `total` no ícone do app. Zero (ou menos) apaga a bolinha. */
export function setAppBadge(total: number): void {
  const nav = badgeApi()
  if (!nav) return
  // Falha em silêncio de propósito: número no ícone é acessório ao trabalho. Se o sistema
  // recusar — permissão negada, app rodando fora da tela de início — não pode virar erro.
  if (total > 0) void nav.setAppBadge(total).catch(() => {})
  else void nav.clearAppBadge().catch(() => {})
}

/** Apaga a bolinha. Usado ao sair da conta, pra não deixar número de outra pessoa no ícone. */
export function clearAppBadge(): void {
  setAppBadge(0)
}
