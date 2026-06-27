// Verbose system status — everything in one place
import { NextResponse } from 'next/server'
import { getGateway } from '@/lib/gateway'
import { queryAll, queryOne } from '@/lib/db'
import fs from 'fs'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gw = getGateway()
  const now = Date.now()

  // Gateway status
  const gwReady = gw.isReady()

  // DB stats
  const tasks = queryAll('SELECT * FROM tasks ORDER BY updated_at DESC')
  const agents = queryAll('SELECT * FROM agents ORDER BY created_at ASC')
  const dispatchLog = queryAll('SELECT * FROM dispatch_log ORDER BY created_at DESC LIMIT 50')

  // Task stats
  const taskStats = {
    total: tasks.length,
    byStatus: (tasks as Array<{status: string}>).reduce<Record<string, number>>((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1
      return acc
    }, {}),
  }

  // Identity
  let identity: unknown = null
  let deviceToken: unknown = null
  try {
    const identityDir = process.env.IDENTITY_DIR || '/app/identity'
    const devRaw = fs.readFileSync(`${identityDir}/device.json`, 'utf8')
    const dev = JSON.parse(devRaw)
    identity = { deviceId: dev.deviceId, hasPublicKey: !!dev.publicKeyPem, hasPrivateKey: !!dev.privateKeyPem }
    const authRaw = fs.readFileSync(`${identityDir}/device-auth.json`, 'utf8')
    const auth = JSON.parse(authRaw)
    deviceToken = { roles: Object.keys(auth.tokens || {}), scopes: Object.values(auth.tokens || {})[0] }
  } catch (e) {
    identity = { error: String(e) }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    gateway: {
      connected: gwReady,
      url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      hasToken: !!process.env.OPENCLAW_GATEWAY_TOKEN,
    },
    identity,
    deviceToken,
    agents,
    taskStats,
    tasks,
    dispatchLog,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_PATH: process.env.DATABASE_PATH || '/app/data/mc.db',
      IDENTITY_DIR: process.env.IDENTITY_DIR || '/app/identity',
    },
  }, {
    headers: { 'Cache-Control': 'no-cache' },
  })
}

// Run arbitrary RPC against gateway
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { method = 'agents.list', params = {} } = body as { method?: string; params?: unknown }
  const gw = getGateway()

  try {
    const result = await gw.rpc(method, params)
    return NextResponse.json({ ok: true, method, result, timestamp: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json({ ok: false, method, error: String(err), timestamp: new Date().toISOString() }, { status: 500 })
  }
}
