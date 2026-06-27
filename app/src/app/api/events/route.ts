import { NextResponse } from 'next/server'
import { addClient, removeClient, broadcast } from '@/lib/events'
import { getGateway } from "@/lib/gateway"
import { startSentinel } from "@/lib/sentinel"
import { startScheduler } from "@/lib/scheduler"

export const dynamic = 'force-dynamic'

export async function GET() {
  // Ensure gateway is initialized and wait up to 5s for it to authenticate
  startSentinel()
  startScheduler()

  const gw = getGateway()

  const encoder = new TextEncoder()
  let ctrl: ReadableStreamDefaultController
  let pingTimer: NodeJS.Timeout | null = null

  const stream = new ReadableStream({
    start(controller) {
      ctrl = controller
      addClient(ctrl)
      ctrl.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`))

      // Send current gateway status — retry until ready or timeout
      const sendGwStatus = () => {
        const status = { connected: gw.isReady() }
        try {
          ctrl.enqueue(encoder.encode(`event: gateway\ndata: ${JSON.stringify(status)}\n\n`))
        } catch { /* client disconnected */ }
      }

      // Send immediately
      sendGwStatus()

      // If not ready, re-send after gateway authenticates
      if (!gw.isReady()) {
        gw.once('ready', () => {
          setTimeout(sendGwStatus, 100)
        })
      }

      // Keepalive ping every 25s
      pingTimer = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          if (pingTimer) clearInterval(pingTimer)
        }
      }, 25000)
    },
    cancel() {
      removeClient(ctrl)
      if (pingTimer) clearInterval(pingTimer)
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
