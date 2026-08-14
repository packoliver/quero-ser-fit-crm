import { readSnapshot, saveSnapshot, type OfflineScope } from './db'
import { queueOfflineMutation } from './sync'

export async function cacheEntity<T>(scope: OfflineScope, entity: string, data: T): Promise<void> {
  await saveSnapshot({ key: `${scope.userId}:${scope.organizationId}:${entity}`, scope, entity, data, savedAt: new Date().toISOString() })
}

export async function readCachedEntity<T>(scope: OfflineScope, entity: string): Promise<T | null> {
  const snapshot = await readSnapshot<T>(`${scope.userId}:${scope.organizationId}:${entity}`)
  return snapshot?.data || null
}

export async function queueEntityMutation(scope: OfflineScope, operation: string, payload: Record<string, unknown>, baseUpdatedAt?: string | null): Promise<string> {
  return queueOfflineMutation(scope, operation, payload, baseUpdatedAt || null)
}
