/**
 * Encerramento de sessão no navegador.
 *
 * Sair não é só `auth.signOut()`: a inscrição de push tem que ser cancelada (senão o
 * aparelho continua recebendo notificação de uma conta que não está mais logada) e o cache
 * offline tem que ser apagado (senão as conversas da conta anterior continuam legíveis no
 * aparelho, e apareceriam pra próxima pessoa que logar nele).
 *
 * Vive aqui, e não dentro de um componente, porque tem mais de um lugar que desloga — o
 * menu do Header e a tela "Mais" do celular — e esquecer um desses dois passos em um deles
 * seria um vazamento silencioso, do tipo que ninguém percebe testando.
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { unsubscribeFromPush } = await import('@/lib/pwa/subscribe')
    await unsubscribeFromPush()
    const { getOfflineScope } = await import('@/lib/offline/scope')
    const { clearOfflineScope } = await import('@/lib/offline/db')
    const scope = await getOfflineScope()
    if (scope) await clearOfflineScope(scope)
    await supabase.auth.signOut()
  } catch {
    // Supabase não configurado, rede caída, push indisponível — quem chama redireciona pro
    // login de qualquer jeito, e é melhor sair com um passo falhando do que ficar preso
    // dentro do app.
  }
}
