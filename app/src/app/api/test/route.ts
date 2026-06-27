// Diagnostic endpoint — tests gateway connectivity and dispatch pipeline
import { NextResponse } from 'next/server'
import { getGateway } from '@/lib/gateway'
import { queryAll, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gw = getGateway()
  const gwReady = gw.isReady()

  const agents = queryAll('SELECT id, name, openclaw_id, status, model_primary FROM agents')
  const tasks = queryAll('SELECT id, title, status, session_id FROM tasks ORDER BY created_at DESC LIMIT 5')
  const dispatchLog = queryAll('SELECT * FROM dispatch_log ORDER BY created_at DESC LIMIT 10')

  return NextResponse.json({
    gateway: { connected: gwReady },
    agents,
    recentTasks: tasks,
    dispatchLog,
    env: {
      GATEWAY_WS: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      IDENTITY_DIR: process.env.IDENTITY_DIR || '/app/identity',
      hasToken: !!process.env.OPENCLAW_GATEWAY_TOKEN,
    },
  }, { status: 200 })
}

export async function POST(req: Request) {
  const { method, params } = await req.json().catch(() => ({ method: 'agents.list', params: {} }))
  const gw = getGateway()

  try {
    const result = await gw.rpc(method, params ?? {})
    return NextResponse.json({ ok: true, method, result })
  } catch (err) {
    return NextResponse.json({ ok: false, method, error: String(err) }, { status: 500 })
  }
}
