import { NextResponse } from 'next/server'
import { getGateway } from '@/lib/gateway'

export async function GET() {
  const gw = getGateway()
  return NextResponse.json({ connected: gw.isReady() })
}

export async function POST(req: Request) {
  const { method, params } = await req.json()
  if (!method) return NextResponse.json({ error: 'method required' }, { status: 400 })

  try {
    const gw = getGateway()
    const result = await gw.rpc(method, params ?? {})
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
