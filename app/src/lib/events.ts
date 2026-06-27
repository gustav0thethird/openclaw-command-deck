// In-memory SSE broadcaster — shared via globalThis for Next.js hot reload stability

const CLIENTS_KEY = '__mc_sse_clients__'

if (!(CLIENTS_KEY in globalThis)) {
  (globalThis as Record<string, unknown>)[CLIENTS_KEY] = new Set<ReadableStreamDefaultController>()
}

const clients = (globalThis as unknown as Record<string, Set<ReadableStreamDefaultController>>)[CLIENTS_KEY]

export function addClient(ctrl: ReadableStreamDefaultController) {
  clients.add(ctrl)
}

export function removeClient(ctrl: ReadableStreamDefaultController) {
  clients.delete(ctrl)
}

export function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const encoder = new TextEncoder()
  for (const ctrl of clients) {
    try {
      ctrl.enqueue(encoder.encode(payload))
    } catch {
      clients.delete(ctrl)
    }
  }
}
