import { timingSafeEqual } from 'node:crypto'
import { getServerEnv } from '@/lib/env'

export function isAuditExecutorAuthorized(request: Request) {
  const expected = getServerEnv().SUPABASE_SERVICE_ROLE_KEY
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '')
  return !!expected && !!supplied && Buffer.byteLength(expected) === Buffer.byteLength(supplied)
    && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
}
