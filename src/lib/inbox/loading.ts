/** Supabase returns query errors as values unless throwOnError is used. */
export function requireInboxResult<T extends { error?: unknown }>(result: T): T {
  if (result.error) throw result.error
  return result
}

/** Bound network/auth waits so a pending request cannot leave the inbox spinning. */
export async function withInboxTimeout<T>(operation: PromiseLike<T>, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('INBOX_TIMEOUT')), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function inboxLoadErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  if (error instanceof Error && error.message === 'INBOX_SESSION_REQUIRED') {
    return 'Sua sessão expirou. Entre novamente para carregar as conversas.'
  }
  if (code === '54001' || code === '42P17') {
    return 'Não foi possível carregar as conversas: erro nas regras de acesso. Contate o administrador.'
  }
  if (code === '42501') {
    return 'Sua conta não tem permissão para carregar as conversas. Contate o administrador.'
  }
  if (code === 'PGRST202' || code === '42883') {
    return 'A consulta de conversas está indisponível. Contate o administrador para atualizar o sistema.'
  }
  if (code === '57014' || (error instanceof Error && error.message === 'INBOX_TIMEOUT')) {
    return 'O carregamento das conversas demorou demais. Tente novamente.'
  }
  return 'Não foi possível carregar as conversas. Verifique sua conexão e tente novamente.'
}
