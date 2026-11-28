// Group chat message search (task 88). Pure parts; the route does the Stream call.

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
export const PAGE_DEFAULT = 20;
export const PAGE_MAX = 50;

/** Trim, collapse whitespace, strip bidi/control chars. null = too short / too long / empty. */
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.replace(/[\u0000-\u001f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < SEARCH_MIN || q.length > SEARCH_MAX) return null;
  return q;
}

export function pageSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PAGE_DEFAULT;
  return Math.min(PAGE_MAX, Math.floor(n));
}

/** Stream's opaque cursor; anything else is dropped rather than forwarded. */
export function cleanCursor(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_\-=.+/]{1,512}$/.test(raw) ? raw : null;
}

export interface SearchHit {
  id: string;
  text: string;
  authorId: string | null;
  authorName: string | null;
  at: string | null;
}

/** Stream results → the API shape. Deleted messages, thread replies and other channels are dropped. */
export function toHits(
  results: Array<{ message: { id?: string; text?: string; cid?: string; type?: string; parent_id?: string; deleted_at?: unknown; created_at?: unknown; user?: { id?: string; name?: unknown } | null } }>,
  cid: string,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const { message: m } of results) {
    if (!m?.id || m.cid !== cid || m.type === 'deleted' || m.deleted_at || m.parent_id) continue;
    const at = m.created_at ? new Date(m.created_at as string).toISOString() : null;
    out.push({ id: m.id, text: m.text ?? '', authorId: m.user?.id ?? null, authorName: typeof m.user?.name === 'string' ? m.user.name : null, at });
  }
  return out;
}
