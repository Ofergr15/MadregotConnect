// Guards for the two write routes that run without a session (task 78):
// POST /api/push/receipt and POST /api/client-log. In-memory, per instance —
// a brake on one script hammering a route, not a guarantee (same stance as
// createRateLimiter in lib/academy/intake.ts).
import { clientIp, createRateLimiter } from '@/lib/academy/intake';

export const RECEIPT_MAX_BYTES = 2_048;
export const CLIENT_LOG_MAX_BYTES = 4_096;
export const ENDPOINT_MAX_CHARS = 1_024;

/** A real phone shows a handful of pushes a minute; 60 is slack. */
export const allowReceipt = createRateLimiter(60, 60_000);
/** Breadcrumbs come in bursts around a bug; 30/min/IP keeps the burst, drops a loop. */
export const allowClientLog = createRateLimiter(30, 60_000);

export { clientIp };

export type CappedBody = { ok: true; body: unknown } | { ok: false; reason: 'too_large' | 'bad_json' };

/**
 * Reads at most `maxBytes` of a JSON body. Content-Length is checked first (cheap), then the
 * real byte length — a missing or lying header can't sneak a big body past.
 */
export async function readCappedJson(request: Request, maxBytes: number): Promise<CappedBody> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large' };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, reason: 'too_large' };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
}

/** A push endpoint is an https URL of sane length; anything else can't be one of ours. */
export function isPlausiblePushEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > ENDPOINT_MAX_CHARS) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

const SECRET_KEY = /token|password|secret|authorization|cookie|refresh|access_key|api_?key/i;

/** Drops values under keys that look like credentials, at any depth (bounded). */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redactSecrets(v, depth + 1);
  }
  return out;
}
