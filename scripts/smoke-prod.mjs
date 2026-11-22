#!/usr/bin/env node
/**
 * Post-release smoke test against production. READ-ONLY: every request is a GET, so it can
 * never save, publish, notify or push a watch.
 *
 * Signs in as a dedicated test staff account (never a real person's credentials) through
 * Supabase's password grant, the same JWT the app sends, and checks the routes a release
 * just shipped. Run by .github/workflows/prod-smoke.yml after the daily release.
 *
 * env: SMOKE_BASE_URL (default https://www.madregot.app), SUPABASE_URL, SUPABASE_ANON_KEY,
 *      SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_TRAINEE_ID (optional: an academy trainee's athlete id)
 */
const BASE = process.env.SMOKE_BASE_URL || 'https://www.madregot.app';
const { SUPABASE_URL, SUPABASE_ANON_KEY, SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_TRAINEE_ID } = process.env;

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push([name, 'ok']); }
  catch (e) { results.push([name, `FAIL: ${e.message}`]); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
// Actions logs are PUBLIC (public repo): a failure prints a status and the response's key
// names only — never a value (plan content, names, ids).
const shape = (b) => (b && typeof b === 'object' ? Object.keys(b).join(',') : typeof b);
const get = async (path, token) => {
  const r = await fetch(`${BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

/** The Sunday that starts the plan week containing today (Israel), YYYY-MM-DD. */
function planWeek() {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  today.setDate(today.getDate() - today.getDay());
  return today.toISOString().slice(0, 10);
}

async function main() {
  const week = planWeek();
  const pb = `/api/plan-builder/weeks/${week}`;

  // Without credentials: the deploy answers, and the gates hold.
  await check('version answers', async () => {
    const r = await get('/api/version');
    expect(r.status === 200 && r.body?.version, `status ${r.status}`);
    console.log(`  live version ${r.body.version}`);
  });
  await check('plan-builder refuses anonymous callers (401)', async () => {
    const r = await get(pb);
    expect(r.status === 401, `got ${r.status}`);
  });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SMOKE_EMAIL || !SMOKE_PASSWORD) {
    console.log('No smoke account configured (SMOKE_EMAIL / SMOKE_PASSWORD secrets): signed-in checks skipped.');
  } else {
    const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }),
    });
    const token = (await auth.json().catch(() => ({})))?.access_token;
    await check('smoke account signs in', async () => expect(!!token, `auth status ${auth.status}`));
    if (token) {
      await check('auth/me accepts the smoke account token', async () => {
        const r = await get('/api/auth/me', token);
        expect(r.status === 200, `got ${r.status}`);
      });
      await check('group week reads (200)', async () => {
        const r = await get(pb, token);
        expect(r.status === 200 && r.body?.week === week, `got ${r.status} keys=${shape(r.body)}`);
        expect(!('fromClub' in r.body), 'group read carries trainee keys');
      });
      await check('malformed ?athleteId is 400 (trainee weeks shipped)', async () => {
        const r = await get(`${pb}?athleteId=not-a-uuid`, token);
        expect(r.status === 400, `got ${r.status}`);
      });
      if (SMOKE_TRAINEE_ID) {
        await check('trainee week reads with fromClub (200)', async () => {
          const r = await get(`${pb}?athleteId=${SMOKE_TRAINEE_ID}`, token);
          expect(r.status === 200, `got ${r.status} keys=${shape(r.body)}`);
          expect(typeof r.body?.fromClub === 'boolean', 'no fromClub');
          expect(r.body?.athleteId === SMOKE_TRAINEE_ID, 'wrong athleteId');
        });
      }
    }
  }

  for (const [n, s] of results) console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${s === 'ok' ? '' : ` — ${s}`}`);
  if (results.some(([, s]) => s !== 'ok')) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
