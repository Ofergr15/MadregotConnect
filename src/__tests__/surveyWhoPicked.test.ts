import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';

/**
 * WHO PICKED WHICH PACK (feedback #91), for the super user until rollout.
 */
const h = vi.hoisted(() => ({
  caller: { isSuperUser: true, isStaff: false, athleteId: 'me' } as Record<string, unknown>,
  denied: null as Response | null,
  filters: [] as string[],
}));

vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: h.denied, caller: h.caller }),
}));

const rows = [
  { option_index: 1, athletes: { id: 'a', name: 'Eylon' } },
  { option_index: 0, athletes: { id: 'b', name: 'Asaf' } },
  { option_index: 1, athletes: { id: 'me', name: 'Sahar' } },
];

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: (k: string, v: string) => { h.filters.push(`${table}.${k}=${v}`); return q; },
        order: async () => ({ data: rows }),
        maybeSingle: async () => table === 'surveys'
          ? { data: { id: 's', options_he: ['1', '2', '3', 'לא מגיע'] }, error: null }
          : { data: { option_index: 1 } },
      };
      return q;
    },
  }),
}));

import { GET } from '@/app/api/surveys/[id]/route';

const get = (qs = '?athleteId=me') =>
  GET({ nextUrl: new URL(`http://x/api/surveys/s${qs}`) } as never, { params: Promise.resolve({ id: 's' }) }).then(r => r.json());

describe('the survey results', () => {
  beforeEach(() => { h.caller = { isSuperUser: true, isStaff: false, athleteId: 'me' }; h.denied = null; h.filters = []; });

  it('lists who picked each option, in the order they answered, active athletes only', async () => {
    const body = await get();
    expect(body.results.map((r: any) => r.people.map((p: any) => p.name))).toEqual([['Asaf'], ['Eylon', 'Sahar'], [], []]);
    expect(h.filters).toContain('survey_responses.athletes.status=active');
  });

  it('is nobody else\'s until rollout, and never the no-session path', async () => {
    h.caller = { isSuperUser: false, isStaff: false, athleteId: 'me' };
    expect((await get()).results).toBeNull();
    h.caller = { isSuperUser: true, isStaff: false, athleteId: 'me' };
    h.denied = new Response(null, { status: 401 });
    expect((await get()).results).toBeUndefined();
    h.denied = null;
    expect((await get('')).results).toBeNull();
  });

  it('is shown under each option on the page', () => {
    const page = readFileSync('src/app/(app)/dashboard/surveys/[id]/page.tsx', 'utf8');
    expect(page).toMatch(/const people = results\?\.\[i\]\?\.people;/);
    expect(page).toMatch(/setMyResponse\(optionIndex\);\s*void refreshResults\(\);/);
  });
});
