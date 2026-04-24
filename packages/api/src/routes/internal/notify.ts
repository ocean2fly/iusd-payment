/**
 * Notifications module — REMOVED.
 *
 * The SSE stream (`GET /notify/stream/:addr`) and push endpoint
 * (`POST /notify/send`) plus the `pending_notifications` table were
 * removed because:
 *   1. The frontend never subscribed to the SSE stream — zero consumers.
 *   2. The stream URL contained an init1 wallet address, violating the
 *      privacy-in-URL invariant.
 *   3. Server-side `sendNotification()` only ever wrote to a table nobody
 *      read, so the feature was fully dormant.
 *
 * The `sendNotification` and `sendNotificationToMany` exports are kept as
 * no-op stubs so the `gift.ts` call sites can stay in place until the
 * notification system is redesigned. When re-introducing real-time push,
 * re-key it on the caller's own shortId OR rely purely on the Bearer
 * token so the URL stays free of identity-linked fragments.
 */
import type { FastifyInstance } from 'fastify'

export function sendNotification(_address: string, _event: string, _data: any): void {
  // no-op — notification delivery is disabled until a new design lands.
}

export function sendNotificationToMany(_addresses: string[], _event: string, _data: any): void {
  // no-op
}

export async function notifyRoutes(_app: FastifyInstance) {
  // No routes registered. Kept as an exported function so the route
  // registration call in `index.ts` compiles without conditional logic
  // until the import is removed.
}
