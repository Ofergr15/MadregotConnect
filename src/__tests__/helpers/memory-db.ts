/**
 * A small in-memory stand-in for the supabase-js query builder — enough of
 * PostgREST's surface for the watch routes and the plan matcher to run against
 * real rows in a test: select / insert / update / delete / upsert with eq, neq,
 * is, in, not-is, gte, lte, or (eq/is only), order, range, limit, single,
 * maybeSingle, and `!inner` embeds of a parent row by `<table>_id`/`athlete_id`.
 *
 * Unknown tables answer PGRST205 and unknown columns 42703, so "migration not
 * applied yet" can be modelled by leaving a table or column out of `schema`.
 * Every call is logged, so a test can assert exactly which queries ran.
 */

type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

export interface MemoryDbOptions {
  /** table → allowed columns. A table absent here does not exist. */
  schema: Record<string, string[]>;
  /** table → column lists that must be unique together (NULLs never collide). */
  unique?: Record<string, string[][]>;
  /** Columns filled on insert when absent. */
  defaults?: Record<string, () => Row>;
}

export interface QueryLog {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  columns?: string;
  filters: string[];
}

let seq = 0;
export const uid = () => {
  seq += 1;
  const hex = seq.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
};

export function createMemoryDb(opts: MemoryDbOptions) {
  const tables: Record<string, Row[]> = {};
  for (const t of Object.keys(opts.schema)) tables[t] = [];
  const log: QueryLog[] = [];

  const missingTable = (t: string) => ({ code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` });
  const missingColumn = (t: string, c: string) => ({ code: '42703', message: `column ${t}.${c} does not exist` });

  function checkColumns(table: string, cols: string[]): { code: string; message: string } | null {
    const allowed = opts.schema[table];
    for (const c of cols) if (!allowed.includes(c)) return missingColumn(table, c);
    return null;
  }

  function project(table: string, row: Row, columns: string): Row {
    if (!columns || columns.trim() === '*') return { ...row };
    const out: Row = {};
    for (const raw of columns.split(',').map((c) => c.trim()).filter(Boolean)) {
      const embed = /^(\w+)(?:!inner)?\(([^)]*)\)$/.exec(raw);
      if (embed) {
        const [, parent, inner] = embed;
        const fk = row[`${parent.replace(/s$/, '')}_id`];
        const parentRow = (tables[parent] || []).find((r) => r.id === fk);
        out[parent] = parentRow ? project(parent, parentRow, inner) : null;
        continue;
      }
      out[raw] = row[raw] ?? null;
    }
    return out;
  }

  function parseColumns(table: string, columns: string): string[] {
    return columns
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c && c !== '*' && !/\(/.test(c));
  }

  function uniqueViolation(table: string, candidate: Row, ignore?: Row): boolean {
    for (const cols of opts.unique?.[table] || []) {
      if (cols.some((c) => candidate[c] == null)) continue;
      if (tables[table].some((r) => r !== ignore && cols.every((c) => r[c] === candidate[c]))) return true;
    }
    return false;
  }

  class Builder implements PromiseLike<any> {
    private filters: Filter[] = [];
    private filterLog: string[] = [];
    private op: QueryLog['op'] = 'select';
    private columns = '*';
    private payload: Row | Row[] | null = null;
    private returning = false;
    private mode: 'many' | 'single' | 'maybe' = 'many';
    private orderBy: Array<{ col: string; asc: boolean }> = [];
    private rangeFrom = 0;
    private rangeTo = Infinity;
    private upsertConflict: string[] = [];
    private ignoreDuplicates = false;
    private countHead = false;

    constructor(private table: string) {}

    select(columns = '*', o?: { count?: string; head?: boolean }) {
      if (this.op === 'select') this.columns = columns;
      else this.returning = true, (this.columns = columns);
      if (o?.head) this.countHead = true;
      return this;
    }
    insert(payload: Row | Row[]) { this.op = 'insert'; this.payload = payload; return this; }
    update(payload: Row) { this.op = 'update'; this.payload = payload; return this; }
    delete() { this.op = 'delete'; return this; }
    upsert(payload: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      this.op = 'upsert'; this.payload = payload;
      this.upsertConflict = (o?.onConflict || 'id').split(',').map((c) => c.trim());
      this.ignoreDuplicates = !!o?.ignoreDuplicates;
      return this;
    }
    private add(desc: string, f: Filter) { this.filters.push(f); this.filterLog.push(desc); return this; }
    eq(c: string, v: unknown) { return this.add(`${c}=eq.${v}`, (r) => r[c] === v); }
    neq(c: string, v: unknown) { return this.add(`${c}=neq.${v}`, (r) => r[c] !== v); }
    is(c: string, v: unknown) { return this.add(`${c}=is.${v}`, (r) => (v === null ? r[c] == null : r[c] === v)); }
    in(c: string, vs: unknown[]) { return this.add(`${c}=in.(${vs.join(',')})`, (r) => vs.includes(r[c])); }
    gte(c: string, v: any) { return this.add(`${c}=gte.${v}`, (r) => r[c] != null && r[c] >= v); }
    lte(c: string, v: any) { return this.add(`${c}=lte.${v}`, (r) => r[c] != null && r[c] <= v); }
    gt(c: string, v: any) { return this.add(`${c}=gt.${v}`, (r) => r[c] != null && r[c] > v); }
    not(c: string, op: string, v: unknown) {
      if (op !== 'is') throw new Error(`memory-db: not.${op} unsupported`);
      return this.add(`${c}=not.is.${v}`, (r) => (v === null ? r[c] != null : r[c] !== v));
    }
    or(expr: string) {
      const parts = expr.split(',').map((p) => {
        const [c, op, ...rest] = p.split('.');
        const v = rest.join('.');
        if (op === 'eq') return (r: Row) => String(r[c]) === v;
        if (op === 'is' && v === 'null') return (r: Row) => r[c] == null;
        throw new Error(`memory-db: or ${p} unsupported`);
      });
      return this.add(`or=(${expr})`, (r) => parts.some((f) => f(r)));
    }
    order(col: string, o?: { ascending?: boolean }) { this.orderBy.push({ col, asc: o?.ascending !== false }); return this; }
    range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
    limit(n: number) { this.rangeTo = this.rangeFrom + n - 1; return this; }
    returns() { return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }

    then<T1 = any, T2 = never>(ok?: ((v: any) => T1 | PromiseLike<T1>) | null, bad?: ((e: any) => T2 | PromiseLike<T2>) | null) {
      return Promise.resolve().then(() => this.run()).then(ok, bad);
    }

    private run(): { data: any; error: any; count?: number } {
      log.push({ table: this.table, op: this.op, columns: this.columns, filters: this.filterLog });
      if (!(this.table in tables)) return { data: null, error: missingTable(this.table) };
      const rows = tables[this.table];
      const match = (r: Row) => this.filters.every((f) => f(r));
      const colErr = checkColumns(this.table, parseColumns(this.table, this.columns));

      if (this.op === 'select') {
        if (colErr) return { data: null, error: colErr };
        let out = rows.filter(match);
        for (const { col, asc } of [...this.orderBy].reverse()) {
          out = [...out].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1)));
        }
        const count = out.length;
        out = out.slice(this.rangeFrom, this.rangeTo === Infinity ? undefined : this.rangeTo + 1);
        if (this.countHead) return { data: null, error: null, count };
        return this.shape(out.map((r) => project(this.table, r, this.columns)));
      }

      if (this.op === 'insert' || this.op === 'upsert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        for (const r of list) {
          const e = checkColumns(this.table, Object.keys(r));
          if (e) return { data: null, error: e };
        }
        const written: Row[] = [];
        for (const r of list) {
          const row: Row = { id: uid(), created_at: new Date().toISOString(), ...(opts.defaults?.[this.table]?.() || {}), ...r };
          if (this.op === 'upsert') {
            const existing = rows.find((x) => this.upsertConflict.every((c) => x[c] === row[c]));
            if (existing) {
              if (!this.ignoreDuplicates) { Object.assign(existing, r); written.push(existing); }
              continue;
            }
          }
          if (uniqueViolation(this.table, row)) {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${this.table}` } };
          }
          rows.push(row);
          written.push(row);
        }
        if (!this.returning) return { data: null, error: null };
        return this.shape(written.map((r) => project(this.table, r, this.columns)));
      }

      if (this.op === 'update') {
        const e = checkColumns(this.table, Object.keys(this.payload as Row));
        if (e) return { data: null, error: e };
        const hit = rows.filter(match);
        for (const r of hit) {
          const next = { ...r, ...(this.payload as Row) };
          if (uniqueViolation(this.table, next, r)) {
            return { data: null, error: { code: '23505', message: `duplicate key on ${this.table}` } };
          }
          Object.assign(r, this.payload);
        }
        if (!this.returning) return { data: null, error: null };
        return this.shape(hit.map((r) => project(this.table, r, this.columns)));
      }

      // delete
      const keep = rows.filter((r) => !match(r));
      const removed = rows.length - keep.length;
      tables[this.table] = keep;
      return { data: null, error: null, count: removed };
    }

    private shape(out: Row[]) {
      if (this.mode === 'single') {
        if (out.length !== 1) return { data: null, error: { code: 'PGRST116', message: `expected 1 row, got ${out.length}` } };
        return { data: out[0], error: null };
      }
      if (this.mode === 'maybe') {
        if (out.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
        return { data: out[0] ?? null, error: null };
      }
      return { data: out, error: null };
    }
  }

  const client = { from: (table: string) => new Builder(table) };
  return { client: client as any, tables, log };
}
