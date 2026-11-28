import { RETENTION_RULES, filtersFor, cutoffFor, type FilterStep, type RetentionRule } from '@/lib/retention/policy';

/** Structural slice of a Supabase filter builder — what the job uses, nothing more. */
interface Filterable<T> {
  lt(column: string, value: string): T;
  in(column: string, values: string[]): T;
  neq(column: string, value: string): T;
  not(column: string, operator: string, value: string): T;
  or(expr: string): T;
}
type Result = PromiseLike<{ count: number | null; error: { message: string; code?: string } | null }>;
type Query = Filterable<Query> & Result;
export interface RetentionDb {
  from(table: string): {
    select(columns: string, opts: { count: 'exact'; head: true }): Query;
    delete(opts: { count: 'exact' }): Query;
  };
}

export type RetentionMode = 'dry-run' | 'purge';

export interface RuleReport {
  id: string;
  table: string;
  cutoff: string;
  /** Rows due (dry-run) or rows deleted (purge). null when the read failed. */
  rows: number | null;
  /** Set when the table doesn't exist yet (unapplied migration) or the call failed. */
  error?: string;
}

export interface RetentionReport {
  mode: RetentionMode;
  at: string;
  rules: RuleReport[];
  total: number;
}

function apply(q: Query, steps: FilterStep[]): Query {
  let out = q;
  for (const s of steps) {
    if (s.op === 'lt') out = out.lt(s.column, s.value);
    else if (s.op === 'in') out = out.in(s.column, s.values);
    else if (s.op === 'notIn') out = out.not(s.column, 'in', `(${s.values.join(',')})`);
    else if (s.op === 'neq') out = out.neq(s.column, s.value);
    else out = out.or(s.expr);
  }
  return out;
}

/**
 * Runs every retention rule. `dry-run` (the default) only COUNTS what each rule would
 * delete; `purge` deletes it. Rules are independent: one failing (a table not migrated
 * yet, a timeout) is reported and the rest still run. Never throws.
 */
export async function runRetention(
  db: RetentionDb,
  opts: { mode?: RetentionMode; nowMs?: number; rules?: readonly RetentionRule[] } = {},
): Promise<RetentionReport> {
  const mode = opts.mode ?? 'dry-run';
  const nowMs = opts.nowMs ?? Date.now();
  const rules = opts.rules ?? RETENTION_RULES;
  const out: RuleReport[] = [];
  for (const rule of rules) {
    const steps = filtersFor(rule, nowMs);
    const base = db.from(rule.table);
    const q = mode === 'purge' ? base.delete({ count: 'exact' }) : base.select('*', { count: 'exact', head: true });
    try {
      const { count, error } = await apply(q, steps);
      out.push(error
        ? { id: rule.id, table: rule.table, cutoff: cutoffFor(rule, nowMs), rows: null, error: error.code === '42P01' ? 'table missing' : error.message }
        : { id: rule.id, table: rule.table, cutoff: cutoffFor(rule, nowMs), rows: count ?? 0 });
    } catch (err) {
      out.push({ id: rule.id, table: rule.table, cutoff: cutoffFor(rule, nowMs), rows: null, error: (err as Error)?.message || 'failed' });
    }
  }
  return { mode, at: new Date(nowMs).toISOString(), rules: out, total: out.reduce((n, r) => n + (r.rows ?? 0), 0) };
}

/** Purge only when the env says so, exactly. Anything else — unset, "true", "ON " — is a dry run. */
export function retentionModeFromEnv(env: Record<string, string | undefined>): RetentionMode {
  return env.RETENTION_PURGE === 'on' ? 'purge' : 'dry-run';
}
