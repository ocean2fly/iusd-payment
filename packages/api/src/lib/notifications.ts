/**
 * Server-Sent Events (SSE) notification hub.
 *
 * Keeps a Map of address → Set<http.ServerResponse>.
 * Call pushNotification() from anywhere in the API after inserting a claim or approval.
 */
import type { ServerResponse } from 'http'

const streams = new Map<string, Set<ServerResponse>>()

export function registerStream(address: string, res: ServerResponse) {
  const key = address.toLowerCase()
  if (!streams.has(key)) streams.set(key, new Set())
  streams.get(key)!.add(res)
}

export function unregisterStream(address: string, res: ServerResponse) {
  const key = address.toLowerCase()
  streams.get(key)?.delete(res)
  if ((streams.get(key)?.size ?? 0) === 0) streams.delete(key)
}

export function pushNotification(
  address: string,
  type: 'claim' | 'approval',
  payload: Record<string, unknown>,
) {
  const key = address.toLowerCase()
  const conns = streams.get(key)
  if (!conns || conns.size === 0) return
  const data = `data: ${JSON.stringify({ type, ...payload })}\n\n`
  for (const res of conns) {
    try { res.write(data) } catch { conns.delete(res) }
  }
}
