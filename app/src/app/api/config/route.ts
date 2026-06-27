// GET /api/config?key=prime_directive
// POST /api/config body: { key, value }
import { NextResponse } from 'next/server'
import { getConfig, setConfig, queryAll } from '@/lib/db'
import { broadcast } from '@/lib/events'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')

  if (key) {
    const value = getConfig(key)
    return NextResponse.json({ key, value })
  }

  // Return all config rows
  const rows = queryAll<{ key: string; value: string; updated_at: number }>(
    `SELECT key, value, updated_at FROM config ORDER BY key ASC`
  )
  return NextResponse.json(rows)
}

export async function POST(req: Request) {
  let body: { key?: string; value?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { key, value } = body
  if (!key || typeof key !== 'string') {
    return NextResponse.json({ error: 'key required' }, { status: 400 })
  }
  if (value === undefined || value === null) {
    return NextResponse.json({ error: 'value required' }, { status: 400 })
  }
  if (typeof value !== 'string') {
    return NextResponse.json({ error: 'value must be a string' }, { status: 400 })
  }

  setConfig(key, value)
  broadcast('config_update', { key, value })

  return NextResponse.json({ ok: true })
}
