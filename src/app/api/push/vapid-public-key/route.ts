import { NextResponse } from 'next/server'
import { getServerEnv } from '@/lib/env'

export async function GET() {
  const publicKey = getServerEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY
  return NextResponse.json(publicKey ? { enabled: true, publicKey } : { enabled: false })
}
