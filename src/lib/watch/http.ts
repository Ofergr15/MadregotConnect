/** Small response/body helpers shared by the /api/device routes. */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/**
 * The request body as JSON, or null. Bounded: an activity upload with a full
 * route and HR trace is a few hundred KB; anything past `maxBytes` is refused
 * rather than parsed.
 */
export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 256 * 1024): Promise<T | null> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (!text || text.length > maxBytes) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
  } catch {
    return null;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

export const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
