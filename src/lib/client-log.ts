// Fire-and-forget breadcrumb to /api/client-log. Never throws, never blocks —
// logging must not be able to break the app it's trying to debug.
export function logClient(event: string, data?: Record<string, unknown>) {
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data, ts: new Date().toISOString() }),
    }).catch(() => {});
  } catch {
    // synchronous throw from fetch() itself (rare) — swallow
  }
}
