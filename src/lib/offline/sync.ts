import { enqueueMutation, listPendingMutations, removeMutation, updateMutation, type OfflineScope } from './db'

export async function queueOfflineMutation(scope: OfflineScope, operation: string, payload: unknown, baseUpdatedAt: string | null = null): Promise<string> {
  const id = crypto.randomUUID()
  await enqueueMutation({ id, scope, operation, payload, baseUpdatedAt, createdAt: new Date().toISOString(), attempts: 0, status: 'pending' })
  return id
}

export interface ReplayConflict {
  operation: string
  /** Nome de exibição do registro em conflito, quando o servidor devolveu o suficiente pra
   * identificar (title de tarefa/pedido, name de contato) — usado só pra deixar o aviso na
   * tela acionável ("X foi alterado por outra pessoa") em vez de um "1 conflito" genérico
   * que a pessoa não tem como agir sem ir caçar qual registro é. */
  label: string | null
}

export async function replayOfflineMutations(
  scope: OfflineScope
): Promise<{ synced: number; failed: number; conflicts: number; conflictDetails: ReplayConflict[] }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { synced: 0, failed: 0, conflicts: 0, conflictDetails: [] }

  const pending = await listPendingMutations(scope)
  let synced = 0
  let failed = 0
  let conflicts = 0
  const conflictDetails: ReplayConflict[] = []

  for (const mutation of pending) {
    try {
      await updateMutation(mutation.id, { status: 'sending', attempts: mutation.attempts + 1, lastAttemptAt: new Date().toISOString() })
      const response = await fetch('/api/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.id },
        body: JSON.stringify({ operation: mutation.operation, payload: mutation.payload, baseUpdatedAt: mutation.baseUpdatedAt || null }),
      })
      const responseBody = await response.json().catch(() => null)
      if (response.ok) {
        await removeMutation(mutation.id)
        synced++
      } else if (response.status === 409) {
        await updateMutation(mutation.id, { status: 'conflict', lastError: responseBody?.error || 'Conflito de sincronização.', serverResult: responseBody?.result })
        conflicts++
        // O 'result' de um conflito é a versão ATUAL do registro no banco (ver
        // /api/sync/route.ts) — title cobre task/deal, name cobre contact.
        const serverRecord = responseBody?.result as { title?: string; name?: string } | undefined
        conflictDetails.push({ operation: mutation.operation, label: serverRecord?.title || serverRecord?.name || null })
        break
      } else if (response.status >= 400 && response.status < 500) {
        await updateMutation(mutation.id, { status: 'failed', lastError: responseBody?.error || 'Operação rejeitada pelo servidor.' })
        failed++
        break
      } else {
        await updateMutation(mutation.id, { status: 'pending', lastError: 'Servidor indisponível; nova tentativa será feita depois.' })
        break
      }
    } catch {
      await updateMutation(mutation.id, { status: 'pending', lastError: 'Sem conexão com o servidor.' })
      break
    }
  }

  return { synced, failed, conflicts, conflictDetails }
}
