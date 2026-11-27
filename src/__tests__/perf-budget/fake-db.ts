/**
 * A small in-memory Supabase stand-in for the response-size budget (task 67).
 * Applies the filters that change row counts (eq/in/gte/lte/…/range/limit) and the
 * column projection, because both change the JSON size; ignores the rest. Writes
 * succeed and change nothing. Not a general-purpose fake — see perfBudget.test.ts.
 */
type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

function project(row: Row, select: string): Row {
  if (!select || select.trim() === '*') return row;
  const out: Row = {};
  let depth = 0; let cur = '';
  const parts: string[] = [];
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p === '*') { Object.assign(out, row); continue; }
    if (p.includes('(')) {
      // An embed is modelled only when the seeded row already carries it nested.
      const head = p.slice(0, p.indexOf('(')).trim();
      const inner = p.slice(p.indexOf('(') + 1, p.lastIndexOf(')'));
      const [alias, target] = head.includes(':') ? head.split(':').map((s) => s.trim()) : [head, head];
      const key = target.split('!')[0].trim();
      const v = row[key];
      if (Array.isArray(v)) out[alias] = v.map((x) => project(x as Row, inner));
      else if (v && typeof v === 'object') out[alias] = project(v as Row, inner);
      else if (key in row) out[alias] = v;
      continue;
    }
    const [alias, col] = p.includes(':') ? p.split(':').map((s) => s.trim()) : [p, p];
    const key = col.split('::')[0].split('->')[0];
    if (key in row) out[alias] = row[key];
  }
  return out;
}

const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

export function fakeDb(tables: Tables) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let select = '*';
    let order: { col: string; asc: boolean } | null = null;
    let lo = 0; let hi = Infinity;
    let one: 'single' | 'maybe' | null = null;
    let head = false; let count = false;
    let write = false;
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: (s?: string, opts?: { count?: string; head?: boolean }) => { if (!write) select = s || '*'; count = !!opts?.count; head = !!opts?.head; return chain; },
      insert: () => { write = true; return chain; },
      upsert: () => { write = true; return chain; },
      update: () => { write = true; return chain; },
      delete: () => { write = true; return chain; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return chain; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return chain; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return chain; },
      gte: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return chain; },
      gt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) > 0); return chain; },
      lte: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) <= 0); return chain; },
      lt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return chain; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return chain; },
      not: self, or: self, ilike: self, like: self, contains: self, overlaps: self, filter: self, match: self, textSearch: self,
      order: (c: string, o?: { ascending?: boolean }) => { if (!order) order = { col: c, asc: o?.ascending !== false }; return chain; },
      limit: (n: number) => { hi = Math.min(hi, lo + n - 1); return chain; },
      range: (a: number, b: number) => { lo = a; hi = b; return chain; },
      abortSignal: self, returns: self, throwOnError: self,
      single: () => { one = 'single'; return chain; },
      maybeSingle: () => { one = 'maybe'; return chain; },
      csv: self,
    });
    const run = () => {
      if (write) return { data: null, error: null, count: null };
      let rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
      if (order) { const { col, asc } = order; rows = [...rows].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col])); }
      const total = rows.length;
      rows = rows.slice(lo, hi === Infinity ? undefined : hi + 1).map((r) => project(r, select));
      if (head) return { data: null, error: null, count: total };
      if (one) return { data: rows[0] ?? null, error: rows[0] || one === 'maybe' ? null : { code: 'PGRST116', message: 'no rows' }, count: null };
      return { data: rows, error: null, count: count ? total : null };
    };
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
    return chain;
  };
  const db = {
    from,
    rpc: () => Promise.resolve({ data: null, error: { code: '42883', message: 'rpc not modelled' } }),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    channel: () => ({ send: async () => ({}), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
  return db;
}
