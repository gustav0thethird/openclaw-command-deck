// OpenClaw Gateway WebSocket client with device identity signing
import { EventEmitter } from 'events'
import { WebSocket } from 'ws'
import crypto from 'crypto'
import fs from 'fs'
import { broadcast } from './events'
import { queryAll, run } from './db'

const GATEWAY_WS = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || ''
const IDENTITY_DIR = process.env.IDENTITY_DIR || '/app/identity'
const GATEWAY_KEY = '__mc_gateway_client__'

// ─── Device Identity ──────────────────────────────────────────
interface DeviceIdentity {
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
}

interface DeviceAuthToken {
  token: string
  role: string
  scopes: string[]
}

function loadDeviceIdentity(): DeviceIdentity | null {
  try {
    const raw = fs.readFileSync(`${IDENTITY_DIR}/device.json`, 'utf8')
    const d = JSON.parse(raw)
    if (d.deviceId && d.publicKeyPem && d.privateKeyPem) return d
  } catch { /* no identity */ }
  return null
}

function loadDeviceToken(role = 'operator'): string | null {
  try {
    const raw = fs.readFileSync(`${IDENTITY_DIR}/device-auth.json`, 'utf8')
    const d = JSON.parse(raw)
    const t: DeviceAuthToken = d.tokens?.[role]
    return t?.token ?? null
  } catch { /* no token */ }
  return null
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function publicKeyRawBase64Url(pem: string): string {
  const spki = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }) as Buffer
  const raw = (spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX))
    ? spki.subarray(ED25519_SPKI_PREFIX.length)
    : spki
  return raw.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem)
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key)
  return sig.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function buildSigningPayload(params: {
  deviceId: string; clientId: string; clientMode: string
  role: string; scopes: string[]; signedAtMs: number
  token: string | null; nonce?: string
}): string {
  const version = params.nonce ? 'v2' : 'v1'
  const parts = [version, params.deviceId, params.clientId, params.clientMode,
    params.role, params.scopes.join(','), String(params.signedAtMs), params.token ?? '']
  if (version === 'v2') parts.push(params.nonce ?? '')
  return parts.join('|')
}

// ─── Gateway Client ───────────────────────────────────────────
interface PendingRequest {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private ready = false

  constructor() {
    super()
    this.setMaxListeners(50)
    this.connect()
  }

  private connect() {
    const url = new URL(GATEWAY_WS)
    if (GATEWAY_TOKEN) url.searchParams.set('token', GATEWAY_TOKEN)

    console.log('[Gateway] Connecting to', url.hostname + ':' + url.port)
    const ws = new WebSocket(url.toString())
    this.ws = ws

    ws.on('open', () => console.log('[Gateway] WS open'))

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(raw.toString()) } catch { return }

      const msgType = msg.type as string

      // ── Challenge-response auth ──
      if (msgType === 'event' && msg.event === 'connect.challenge') {
        const nonce = (msg.payload as Record<string, unknown>)?.nonce as string | undefined
        const requestId = crypto.randomUUID()

        const role = 'operator'
        const scopes = ['operator.admin', 'operator.write', 'operator.read', 'operator.approvals']
        const clientId = 'cli'
        const clientMode = 'ui'
        const signedAtMs = Date.now()

        const identity = loadDeviceIdentity()
        const deviceToken = loadDeviceToken(role)

        // Use device token if available, else fall back to gateway token
        const authToken = deviceToken ?? GATEWAY_TOKEN

        let device: Record<string, unknown> | undefined
        if (identity) {
          const payload = buildSigningPayload({
            deviceId: identity.deviceId,
            clientId, clientMode, role, scopes, signedAtMs,
            token: authToken, nonce,
          })
          const signature = signPayload(identity.privateKeyPem, payload)
          device = {
            id: identity.deviceId,
            publicKey: publicKeyRawBase64Url(identity.publicKeyPem),
            signature,
            signedAt: signedAtMs,
            nonce,
          }
          console.log('[Gateway] Device signing: deviceId =', identity.deviceId.slice(0, 16) + '...')
        } else {
          console.warn('[Gateway] No device identity found at', IDENTITY_DIR)
        }

        const timer = setTimeout(() => {
          this.pending.delete(requestId)
          console.error('[Gateway] Auth timeout')
          ws.close()
        }, 15000)

        this.pending.set(requestId, {
          resolve: () => {
            this.ready = true
            this.emit('ready')
            broadcast('gateway', { connected: true, ready: true })
            console.log('[Gateway] Authenticated ✓  scopes:', scopes.join(', '))
          },
          reject: (err) => {
            console.error('[Gateway] Auth failed:', err.message)
            ws.close()
          },
          timer,
        })

        ws.send(JSON.stringify({
          type: 'req', id: requestId, method: 'connect',
          params: {
            minProtocol: 3, maxProtocol: 3,
            client: { id: clientId, version: '1.0.1', platform: 'linux', mode: clientMode },
            auth: { token: authToken },
            role, scopes, device,
          },
        }))
        return
      }

      // ── RPC responses ──
      const msgId = String(msg.id ?? '')
      if (msg.id != null && this.pending.has(msgId)) {
        const req = this.pending.get(msgId)!
        clearTimeout(req.timer)
        this.pending.delete(msgId)
        if (msg.error) {
          const errMsg = typeof msg.error === 'object'
            ? ((msg.error as Record<string, unknown>).message ?? JSON.stringify(msg.error))
            : String(msg.error)
          req.reject(new Error(String(errMsg)))
        } else {
          req.resolve(msg.result ?? msg.data)
        }
        return
      }

      // ── Fallback simple auth ──
      if (msgType === 'challenge') {
        ws.send(JSON.stringify({ type: 'auth', token: GATEWAY_TOKEN }))
        return
      }
      if (msgType === 'auth_ok' || msgType === 'ready') {
        this.ready = true; this.emit('ready')
        broadcast('gateway', { connected: true, ready: true })
        return
      }

      // ── Push events ──
      if (msgType === 'event' && msg.event) {
        const eventName = msg.event as string
        this.emit(eventName, msg.payload)
        // Handle agent stream events (streaming text + lifecycle end)
        if (eventName === 'agent') {
          const p = (msg.payload ?? {}) as Record<string, unknown>
          const stream = p.stream as string
          const data = p.data as Record<string, unknown> | undefined
          // Log only key lifecycle events, not every text delta
          if (stream === 'lifecycle') console.log(`[Gateway] agent lifecycle phase=${data?.phase} session=${(p.sessionKey as string)?.split(':').pop()}`)
          if (stream === 'assistant' && data?.text) {
            const txt = (data.text as string)
            if (txt.length < 50 || txt.includes('TASK_COMPLETE') || txt.includes('TEST_PASS') || txt.includes('TEST_FAIL')) {
              console.log(`[Gateway] agent text="${txt.slice(0, 120)}"`)
            }
          }
          this.handleAgentEvent(p)
        }
        // Legacy chat event format
        if (eventName === 'chat') this.handleLegacyChatEvent((msg.payload ?? {}) as Record<string, unknown>)
        return
      }
      if (msgType === 'chat_event') {
        this.handleLegacyChatEvent((msg.payload ?? msg) as Record<string, unknown>)
      }
    })

    ws.on('close', () => {
      this.ready = false; this.ws = null
      broadcast('gateway', { connected: false })
      console.log('[Gateway] Disconnected — retrying in 5s')
      setTimeout(() => this.connect(), 5000)
    })

    ws.on('error', (err) => console.error('[Gateway] Error:', err.message))
  }

  // Tracks latest streamed text per sessionKey (for agent stream events)
  private streamBuffer = new Map<string, string>()
  // Maps runId → sessionKey (OpenClaw fallback events lose the sessionKey)
  private runSessionMap = new Map<string, string>()

  private handleAgentEvent(payload: Record<string, unknown>) {
    const runId = payload.runId as string | undefined
    const stream = payload.stream as string
    const data = payload.data as Record<string, unknown> | undefined

    // Resolve sessionKey — may be missing on fallback-model runs
    let sessionKey = payload.sessionKey as string | undefined
    if (!sessionKey && runId) sessionKey = this.runSessionMap.get(runId)

    // Track runId → sessionKey when first seen with a real sessionKey
    if (sessionKey && runId && !this.runSessionMap.has(runId)) {
      this.runSessionMap.set(runId, sessionKey)
      // Cleanup old entries to avoid unbounded growth
      if (this.runSessionMap.size > 200) {
        const firstKey = this.runSessionMap.keys().next().value
        if (firstKey) this.runSessionMap.delete(firstKey)
      }
    }

    if (!sessionKey) return  // Can't match without a sessionKey

    if (stream === 'assistant' && data?.text) {
      // Track the latest full text (OpenClaw sends cumulative text, not just delta)
      this.streamBuffer.set(sessionKey, data.text as string)
      return
    }

    if (stream === 'lifecycle' && data?.phase === 'end') {
      const content = this.streamBuffer.get(sessionKey) ?? ''
      this.streamBuffer.delete(sessionKey)
      if (runId) this.runSessionMap.delete(runId)
      // Emit raw session_end for the agentic loop to consume first
      if (content) this.emit(`session_end:${sessionKey}`, content)
      // resolveTask handles TASK_COMPLETE / TEST_PASS / etc.
      if (content) this.resolveTask(sessionKey, content)
      return
    }

    if (stream === 'lifecycle' && (data?.phase === 'error' || data?.phase === 'abort')) {
      const errMsg = (data?.error as string) ?? 'Agent error'
      console.log(`[Gateway] Agent ${data.phase} on ${sessionKey}: ${errMsg}`)
      // Don't mark as failed — OpenClaw handles its own fallback chain
    }
  }

  // Legacy: handle chat events with state:final (older gateway versions)
  private handleLegacyChatEvent(payload: Record<string, unknown>) {
    if (payload.state !== 'final') return
    const sessionKey = payload.sessionKey as string | undefined
    if (!sessionKey) return
    const content = extractContent(payload.message)
    if (content) this.resolveTask(sessionKey, content)
  }

  private resolveTask(sessionKey: string, content: string) {
    // Task state management is handled entirely by the agent loop in dispatch.ts.
    // Here we only extract output files from code blocks as a fallback for models
    // that write markdown code blocks rather than using the TOOL: write_file format.
    const sessionId = sessionKey.split(':').slice(2).join(':')
    const task = queryAll<{ id: string }>(
      `SELECT id FROM tasks WHERE session_id=? LIMIT 1`,
      [sessionId]
    )[0]
    if (task) this.saveOutputFiles(task.id, content)
  }

  private saveOutputFiles(taskId: string, content: string) {
    const workspacePath = process.env.WORKSPACE_PATH || '/app/workspace'
    const taskDir = `${workspacePath}/${taskId}`

    const langToFile: Record<string, string> = {
      html: 'index.html', htm: 'index.html',
      css: 'style.css', javascript: 'script.js', js: 'script.js',
      typescript: 'script.ts', ts: 'script.ts', tsx: 'component.tsx',
      python: 'script.py', py: 'script.py',
      json: 'output.json', yaml: 'config.yaml', yml: 'config.yml',
      markdown: 'output.md', md: 'output.md',
      sh: 'run.sh', bash: 'run.sh',
      sql: 'query.sql', xml: 'output.xml', svg: 'image.svg',
      text: 'output.txt', txt: 'output.txt', plaintext: 'output.txt',
    }

    const blocks: Array<{ tag: string; body: string }> = []

    // Strategy 1: properly closed fenced blocks  ```tag\nbody\n```
    const closed = /```([\w\-./]+)\r?\n([\s\S]*?)```/g
    let m: RegExpExecArray | null
    while ((m = closed.exec(content)) !== null) {
      blocks.push({ tag: m[1].trim(), body: m[2] })
    }

    // Strategy 2: unclosed fenced blocks — everything from ```tag\n to TASK_COMPLETE or end
    if (blocks.length === 0) {
      const unclosed = /```([\w\-./]+)\r?\n([\s\S]*?)(?=\n(?:TASK_COMPLETE|TEST_PASS|TEST_FAIL|```)|$)/g
      while ((m = unclosed.exec(content)) !== null) {
        const body = m[2].replace(/```\s*$/, '').trimEnd()
        if (body.trim()) blocks.push({ tag: m[1].trim(), body: body + '\n' })
      }
    }

    // Strategy 3: write("filename", "content") pseudo-code from some models
    if (blocks.length === 0) {
      const writeCall = /write\s*\(\s*["']?([\w\-./]+)["']?\s*,\s*["'`]([\s\S]*?)["'`]\s*\)/g
      while ((m = writeCall.exec(content)) !== null) {
        blocks.push({ tag: m[1].trim(), body: m[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t') })
      }
    }

    if (blocks.length === 0) {
      console.log(`[Gateway] No output files found in response for task ${taskId}`)
      return
    }

    const usedNames = new Map<string, number>()
    let saved = 0

    for (const { tag, body } of blocks) {
      if (!body.trim()) continue
      const lowerTag = tag.toLowerCase()
      let filename = lowerTag.includes('.') ? lowerTag : langToFile[lowerTag]
      if (!filename) continue

      // Prevent path traversal
      filename = filename.replace(/\.\./g, '').replace(/^\//, '').replace(/\//g, '-')
      if (!filename) continue

      // Deduplicate filenames
      const count = usedNames.get(filename) ?? 0
      usedNames.set(filename, count + 1)
      if (count > 0) {
        const dot = filename.lastIndexOf('.')
        filename = dot >= 0
          ? `${filename.slice(0, dot)}-${count}${filename.slice(dot)}`
          : `${filename}-${count}`
      }

      try {
        if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true })
        fs.writeFileSync(`${taskDir}/${filename}`, body)
        console.log(`[Gateway] Saved workspace file: ${taskDir}/${filename} (${body.length} bytes)`)
        try { broadcast('file_saved', { taskId, path: `${taskId}/${filename}` }) } catch {}
        saved++
      } catch (err) {
        console.warn(`[Gateway] Failed to save file ${filename}:`, err)
      }
    }

    console.log(`[Gateway] File extraction for task ${taskId}: ${saved}/${blocks.length} saved`)
  }

  async rpc(method: string, params: unknown): Promise<unknown> {
    await this.waitReady()
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, 60000)
      this.pending.set(id, { resolve, reject, timer })
      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  private waitReady(): Promise<void> {
    if (this.ready) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Gateway not ready')), 15000)
      this.once('ready', () => { clearTimeout(t); resolve() })
    })
  }

  isReady() { return this.ready }
}

function extractContent(message: unknown): string {
  if (typeof message === 'string') return message
  if (!message || typeof message !== 'object') return ''
  const m = message as Record<string, unknown>
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    return (m.content as Array<{ type?: string; text?: string }>)
      .filter(c => c.type === 'text' && c.text).map(c => c.text!).join('\n')
  }
  return ''
}

export function getGateway(): GatewayClient {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[GATEWAY_KEY]) g[GATEWAY_KEY] = new GatewayClient()
  return g[GATEWAY_KEY] as GatewayClient
}
