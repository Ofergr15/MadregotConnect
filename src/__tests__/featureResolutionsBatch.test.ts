import { describe, expect, it } from 'vitest';
import { featureResolution, featureResolutions } from '@/lib/features/server';
import { FEATURE_KEYS, CLUB_SCOPE_ID } from '@/lib/features/flags';

/** features/me resolves every key in two round trips; answers must equal the per-key resolver's. */

type Row = Record<string, unknown>;
function fakeDb(rows: Row[] | 'missing', athlete: Row | null) {
  const counts = { feature_enablements: 0, athletes: 0 };
  const client = {
    from(table: 'feature_enablements' | 'athletes') {
      counts[table]++;
      let filter: (r: Row) => boolean = () => true;
      const res = () => {
        if (table === 'athletes') return { data: athlete, error: null };
        if (rows === 'missing') return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
        return { data: rows.filter(filter), error: null };
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filter = (r) => r[c] === v; return table === 'athletes' ? q : Promise.resolve(res()); },
        in: (c: string, v: unknown[]) => { filter = (r) => v.includes(r[c]); return Promise.resolve(res()); },
        maybeSingle: () => Promise.resolve(res()),
      };
      return q;
    },
  };
  return { client, counts };
}

const ME = { id: 'a1', group_id: 'g2', role: 'runner', extra_roles: ['core_runner'], is_academy: true };
const keys = FEATURE_KEYS;
const rows: Row[] = keys.flatMap((f, i) => {
  const out: Row[] = [];
  if (i % 2 === 0) out.push({ feature: f, scope_type: 'club', scope_id: CLUB_SCOPE_ID, enabled: i % 4 === 0, set_by: 's', set_at: 't' });
  if (i % 3 === 0) out.push({ feature: f, scope_type: 'athlete', scope_id: 'a1', enabled: i % 2 === 1, set_by: 's', set_at: 't' });
  if (i % 5 === 0) out.push({ feature: f, scope_type: 'athlete', scope_id: 'someone-else', enabled: true, set_by: 's', set_at: 't' });
  if (i % 7 === 0) out.push({ feature: f, scope_type: 'group', scope_id: 'g2', enabled: true, set_by: 's', set_at: 't' });
  return out;
});

describe('featureResolutions', () => {
  it('equals featureResolution for every key', async () => {
    const one = fakeDb(rows, ME);
    const batch = await featureResolutions(keys, 'a1', one.client as never);
    for (const f of keys) {
      const single = await featureResolution(f, 'a1', fakeDb(rows, ME).client as never);
      expect(batch[f], f).toEqual(single);
    }
    expect(one.counts.feature_enablements).toBe(1);
    expect(one.counts.athletes).toBe(1);
  });

  it('fails closed on a missing table or an unknown athlete', async () => {
    const a = await featureResolutions(keys, 'a1', fakeDb('missing', ME).client as never);
    const b = await featureResolutions(keys, 'a1', fakeDb(rows, null).client as never);
    for (const f of keys) {
      expect(a[f]).toEqual({ enabled: false, source: null });
      expect(b[f]).toEqual({ enabled: false, source: null });
    }
  });
});
