export interface OfflineScope {
  userId: string
  organizationId: string
}

export interface OfflineSnapshot<T = unknown> {
  key: string
  scope: OfflineScope
  entity: string
  data: T
  savedAt: string
}

export interface OfflineMutation {
  id: string
  scope: OfflineScope
  operation: string
  payload: unknown
  baseUpdatedAt?: string | null
  createdAt: string
  attempts: number
  status: 'pending' | 'sending' | 'failed' | 'conflict'
  lastError?: string
  lastAttemptAt?: string
  serverResult?: unknown
}

const DB_NAME = 'qsf-crm-offline'
const DB_VERSION = 1
const SNAPSHOTS = 'snapshots'
const MUTATIONS = 'mutations'

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB não está disponível neste navegador.')
  return indexedDB
}

export function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = requireIndexedDb().open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(MUTATIONS)) {
        const store = db.createObjectStore(MUTATIONS, { keyPath: 'id' })
        store.createIndex('scope', ['scope.userId', 'scope.organizationId'])
        store.createIndex('status', 'status')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento offline.'))
  })
}

export function scopeKey(scope: OfflineScope): string {
  return `${scope.userId}:${scope.organizationId}`
}

export async function saveSnapshot<T>(snapshot: OfflineSnapshot<T>): Promise<void> {
  const db = await openOfflineDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS, 'readwrite')
    tx.objectStore(SNAPSHOTS).put(snapshot)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function readSnapshot<T>(key: string): Promise<OfflineSnapshot<T> | null> {
  const db = await openOfflineDb()
  return await new Promise((resolve, reject) => {
    const request = db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).get(key)
    request.onsuccess = () => { db.close(); resolve((request.result as OfflineSnapshot<T> | undefined) || null) }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

export async function enqueueMutation(mutation: OfflineMutation): Promise<void> {
  const db = await openOfflineDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MUTATIONS, 'readwrite')
    tx.objectStore(MUTATIONS).put(mutation)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function listPendingMutations(scope: OfflineScope): Promise<OfflineMutation[]> {
  const db = await openOfflineDb()
  return await new Promise((resolve, reject) => {
    const request = db.transaction(MUTATIONS, 'readonly').objectStore(MUTATIONS).getAll()
    request.onsuccess = () => {
      db.close()
      resolve((request.result as OfflineMutation[]).filter((item) => item.scope.userId === scope.userId && item.scope.organizationId === scope.organizationId && item.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

export async function updateMutation(id: string, patch: Partial<OfflineMutation>): Promise<void> {
  const db = await openOfflineDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MUTATIONS, 'readwrite')
    const store = tx.objectStore(MUTATIONS)
    const request = store.get(id)
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, ...patch })
    }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function removeMutation(id: string): Promise<void> {
  const db = await openOfflineDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MUTATIONS, 'readwrite')
    tx.objectStore(MUTATIONS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function clearOfflineScope(scope: OfflineScope): Promise<void> {
  const db = await openOfflineDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SNAPSHOTS, MUTATIONS], 'readwrite')
    const snapshots = tx.objectStore(SNAPSHOTS)
    const mutations = tx.objectStore(MUTATIONS)
    for (const store of [snapshots, mutations]) {
      const request = store.getAll()
      request.onsuccess = () => {
        for (const value of request.result as Array<{ key?: string; id?: string; scope?: OfflineScope }>) {
          const key = value.key || value.id
          if (key && value.scope?.userId === scope.userId && value.scope.organizationId === scope.organizationId) store.delete(key)
        }
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
