import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CONTRACT for the native U21 questionnaire client: POST /api/u21/register.
 * Pins the request the route accepts, the exact row it stores, every error shape, how a
 * repeated submit behaves TODAY, and the env guard. See docs/contracts/u21-register.md.
 */

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (p: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(p)}.sig`;
const REF = 'rtcgklespcwvxashhamh';
const APPROVED = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: REF }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', ref: REF }),
};
const env = (over: Record<string, string | undefined> = {}) => {
  for (const [k, v] of Object.entries({ ...APPROVED, ...over })) vi.stubEnv(k, v as string);
};

let rows: Record<string, unknown>[] = [];
let dbError: unknown = null;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: (table: string) => {
    const f: Record<string, unknown> = {};
    const q: any = {
      select: () => q, eq: (k: string, v: unknown) => { f[k] = v; return q; }, gte: () => q,
      limit: async () => ({ data: rows.filter((r) => r.email === f.email && r.track === f.track), error: null }),
      insert: async (r: Record<string, unknown>) => { if (!dbError) rows.push({ table, ...r }); return { error: dbError }; },
    };
    return q;
  } }),
}));
const { POST } = await import('@/app/api/u21/register/route');

let ip = 0;
const send = (body: unknown, from = `9.9.${++ip}.1`) => POST(new Request('http://x/api/u21/register', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));
const yearsAgo = (y: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };

const ADULT = {
  firstName: ' נועה ', lastName: 'כהן', email: 'Noa@Example.com', phone: '050-123-4567', birthDate: yearsAgo(19),
  framework: 'אחר', frameworkOther: 'קבוצת ריצה', goal: 'גיבוש', targetDate: '', experience: 'פחות משנה',
  fitnessResults: '3 ק״מ ב־13:00', runsPerWeek: '1–2', weeklyKm: '15', strengthExperience: 'מעט', otherTraining: '',
  availableDays: ['ראשון', 'שלישי'], equipment: ['מתח'], sleepHours: '7–8', recovery: 'טוב',
  chestPain: 'no', fainting: 'no', bonePain: 'yes', acuteInjury: 'no', injuries: '', preferences: '',
  guardianName: 'should be dropped for an adult', unknownKey: 'dropped',
};
const MINOR = { ...ADULT, birthDate: yearsAgo(16), guardianName: 'אבא', guardianPhone: '0521112222', guardianConsent: true };

beforeEach(() => { rows = []; dbError = null; env(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('request → 200 { ok: true, status: "pending_review" }', () => {
  it('an adult: stores one row, trimmed, lower-cased email, guardian null, unknown keys dropped', async () => {
    const res = await send({ track: 'advanced', answers: ADULT });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'pending_review' });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({
      table: 'u21_registrations', track: 'advanced', first_name: 'נועה', last_name: 'כהן', email: 'noa@example.com',
      phone: '050-123-4567', age_band: '18-21', framework: 'אחר', guardian_name: null, guardian_phone: null,
      guardian_consent: false, flag_bone_pain: true, flag_chest_pain: false, red_flag: true, status: 'pending_review',
    });
    expect(Object.keys(r.intake as object)).not.toContain('unknownKey');
    expect(Object.keys(r.intake as object)).not.toContain('guardianName');
  });
  it('a minor (16-17): guardian fields stored, band 16-17', async () => {
    await send({ track: 'basic', answers: MINOR });
    expect(rows[0]).toMatchObject({ age_band: '16-17', guardian_name: 'אבא', guardian_phone: '0521112222', guardian_consent: true });
  });
  it('a red flag changes nothing in the response', async () => {
    const clean = await (await send({ track: 'pro', answers: { ...ADULT, bonePain: 'no' } })).json();
    const flagged = await (await send({ track: 'pro', answers: { ...ADULT, chestPain: 'yes' } })).json();
    expect(flagged).toEqual(clean);
  });
});

describe('validation → 400 { error: "validation", errors: { [field]: hebrew message } }', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ['track', { track: 'gold' }, 'track'],
    ['missing firstName', { answers: { ...ADULT, firstName: '' } }, 'firstName'],
    ['wrong type for a text field', { answers: { ...ADULT, lastName: true } }, 'lastName'],
    ['bad email', { answers: { ...ADULT, email: 'noa@' } }, 'email'],
    ['bad phone', { answers: { ...ADULT, phone: '12345' } }, 'phone'],
    ['under 16', { answers: { ...ADULT, birthDate: yearsAgo(15) } }, 'birthDate'],
    ['over 21', { answers: { ...ADULT, birthDate: yearsAgo(23) } }, 'birthDate'],
    ['not a date', { answers: { ...ADULT, birthDate: 'yesterday' } }, 'birthDate'],
    ['radio value not in options', { answers: { ...ADULT, experience: 'הרבה' } }, 'experience'],
    ['checkboxes value not in options', { answers: { ...ADULT, availableDays: ['Monday'] } }, 'availableDays'],
    ['required checkboxes empty', { answers: { ...ADULT, availableDays: [] } }, 'availableDays'],
    ['yesno not yes/no', { answers: { ...ADULT, fainting: 'maybe' } }, 'fainting'],
    ['weeklyKm not a number', { answers: { ...ADULT, weeklyKm: '15km' } }, 'weeklyKm'],
    ['weeklyKm over 300', { answers: { ...ADULT, weeklyKm: '301' } }, 'weeklyKm'],
    ['text over 2000 chars', { answers: { ...ADULT, goal: 'א'.repeat(2001) } }, 'goal'],
    ['minor without guardian consent', { answers: { ...MINOR, guardianConsent: false } }, 'guardianConsent'],
    ['minor without guardian phone', { answers: { ...MINOR, guardianPhone: '' } }, 'guardianPhone'],
  ])('%s', async (_label, over, field) => {
    const res = await send({ track: 'basic', answers: ADULT, ...over });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation');
    expect(typeof body.errors[field]).toBe('string');
    expect(rows).toEqual([]);
  });
  it('answers missing or not an object → errors.answers', async () => {
    for (const answers of [undefined, null, [], 'x']) {
      const res = await send({ track: 'basic', answers });
      expect(await res.json()).toEqual({ error: 'validation', errors: { answers: 'ערך לא תקין' } });
    }
  });
  it('a body that is not a JSON object → 400 { error: "Invalid body" }', async () => {
    for (const b of ['not json', '[]', 'null']) expect(await (await send(b)).json()).toEqual({ error: 'Invalid body' });
  });
  it('all errors at once, keyed by field', async () => {
    const body = await (await send({ track: 'basic', answers: { ...ADULT, email: 'x', phone: 'y' } })).json();
    expect(Object.keys(body.errors).sort()).toEqual(['email', 'phone']);
  });
});

describe('repeat submits', () => {
  it('the same email + track inside 10 minutes stores ONE row; both answer the same 200', async () => {
    const a = await send({ track: 'basic', answers: ADULT }, '7.7.7.7');
    const b = await send({ track: 'basic', answers: { ...ADULT, email: 'NOA@example.com' } }, '7.7.7.8');
    expect([await a.json(), await b.json()]).toEqual([{ ok: true, status: 'pending_review' }, { ok: true, status: 'pending_review' }]);
    expect(rows).toHaveLength(1);
  });
  it('a different track is a different registration', async () => {
    await send({ track: 'basic', answers: ADULT });
    await send({ track: 'pro', answers: ADULT });
    expect(rows).toHaveLength(2);
  });
  it('the only server brake: the 11th request in a minute from one IP → 429 { error: "Too many attempts" }', async () => {
    const from = '8.8.8.8';
    for (let i = 0; i < 10; i++) expect((await send({ track: 'basic', answers: { ...ADULT, email: `n${i}@example.com` } }, from)).status).toBe(200);
    const res = await send({ track: 'basic', answers: ADULT }, from);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Too many attempts' });
  });
  it('honeypot `website` filled → the same 200 body, nothing stored', async () => {
    const res = await send({ track: 'basic', answers: ADULT, website: 'http://spam' });
    expect(await res.json()).toEqual({ ok: true, status: 'pending_review' });
    expect(rows).toEqual([]);
  });
});

describe('server failures never leak', () => {
  it('a DB error → 500 { error: "Could not save" }', async () => {
    dbError = { message: 'duplicate key u21_registrations_pkey', code: '23505' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await send({ track: 'basic', answers: ADULT });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Could not save' });
  });
});

describe('env guard (runs before anything else) → 503 { error: "Service unavailable" }', () => {
  const refused = async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await send({ track: 'basic', answers: ADULT });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Service unavailable' });
    expect(rows).toEqual([]);
  };
  it('no Supabase env at all (a bare test/CI environment)', async () => {
    vi.unstubAllEnvs();
    env({ NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' });
    await refused();
  });
  it('any other project, including a self-consistent one (production)', async () => {
    const other = 'abcdefghijklmnopqrst';
    env({
      NEXT_PUBLIC_SUPABASE_URL: `https://${other}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: other }),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', ref: other }),
    });
    await refused();
  });
  it('a local Supabase on Vercel', async () => {
    env({ NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role' }), NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon' }), VERCEL: '1' });
    await refused();
  });
  it('the guard wins over the rate limit and over a bad body', async () => {
    env({ NEXT_PUBLIC_SUPABASE_URL: 'https://nope.example' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await send('not json')).status).toBe(503);
  });
  it('a local Supabase on a developer machine is allowed', async () => {
    env({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role' }), NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon' }), VERCEL: '' });
    expect((await send({ track: 'basic', answers: ADULT })).status).toBe(200);
  });
});
