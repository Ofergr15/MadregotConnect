// Shared fake Supabase for the b23 pack/race route tests: `tables[name]` answers every read on
// that table; writes are recorded in `writes`.
export type Call = [string, unknown[]];
export interface Op { table: string; calls: Call[] }

export function makeFakeDb(tables: Record<string, (op: Op) => unknown[]>, writes: Op[] = []) {
  const respond = (op: Op) => {
    if (op.calls.some(([m]) => ['insert', 'update', 'upsert', 'delete'].includes(m))) writes.push(op);
    const f = tables[op.table];
    return { data: f ? f(op) : [], error: null as unknown };
  };
  const chain = (op: Op): unknown => new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') {
        return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(op)).then(res, rej);
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => { const { data, error } = respond(op); return Promise.resolve({ data: (data as unknown[])[0] ?? null, error }); };
      }
      return (...args: unknown[]) => { op.calls.push([prop, args]); return chain(op); };
    },
  });
  return { from(table: string) { return chain({ table, calls: [] }); } };
}

/** The value of `.eq(column, v)` in a recorded op. */
export function eqOf(op: Op, column: string): unknown {
  const c = op.calls.find(([m, a]) => m === 'eq' && a[0] === column);
  return c ? c[1][1] : undefined;
}

export const session = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  user: {
    email: 'x@madregot.local', athleteId: 'runner-1', name: 'R', role: 'runner', roles: ['runner'],
    groupId: null, athleteStatus: 'active', isStaff: false, isSuperUser: false, canApprove: false, isCoreRunner: false,
    ...over,
  },
});
