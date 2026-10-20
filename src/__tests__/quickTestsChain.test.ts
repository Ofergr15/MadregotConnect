import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { cleanRows, type ImportRow } from '@/lib/academy/sheet-import';

/**
 * The quick-test chain (Ofer's morning run, 2026-10-21): the test identities of flows 3 and 4
 * walked through the REAL routes on an in-memory database — invite, the form's prefill, the
 * confirmation — asserting every mail (template + recipient + link) on the way. With QT_OUT
 * set, the prefill payloads are written out for the screen harness, so the screenshots in
 * the test document are of exactly what these routes answer.
 */

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const mail = vi.hoisted(() => ({ form: vi.fn(async (_p: unknown) => ({ ok: true })), admin: vi.fn(async () => ({ ok: true })), received: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email', () => ({
  notifyAcademyExistingForm: (p: unknown) => mail.form(p),
  notifyAdminNewAcademyRegistration: () => mail.admin(),
  notifyAcademyFormReceived: () => mail.received(),
}));
const MANAGER = vi.hoisted(() => '00000000-0000-4000-8000-00000000aaaa');
const pair = vi.hoisted(() => vi.fn(async (_id: string, _c: string[]) => ({ ok: true })));
vi.mock('@/lib/academy/pairing-server', async (orig) => ({
  ...(await orig<object>()),
  requireAcademyManager: async () => ({ denied: null, caller: { athleteId: MANAGER, email: 'manager@example.com', role: 'academy_manager', roles: ['academy_manager'], isStaff: true, isSuperUser: false } }),
  setPairCoaches: (id: string, c: string[]) => pair(id, c),
}));
const bulk = vi.hoisted(() => vi.fn(async (_req: unknown, _caller: unknown) => new Response(JSON.stringify({ results: [{ ok: true }] }))));
vi.mock('@/lib/academy/manage-server', () => ({ runBulk: (r: unknown, c: unknown) => bulk(r, c) }));
const accept = vi.hoisted(() => vi.fn(async (_id: string, _caller: unknown, _b: unknown) => new Response(JSON.stringify({ ok: true }))));
vi.mock('@/lib/academy/admit-server', () => ({ acceptAction: (id: string, c: unknown, b: unknown) => accept(id, c, b) }));
const staffPush = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/notifications/staff', () => ({ academyManagerIds: async () => [], notifyStaff: () => staffPush() }));
vi.mock('@/lib/academy/link-server', async (orig) => ({ ...(await orig<object>()), likelyClubMember: async () => null }));
vi.mock('@/lib/academy/registration', () => ({ mayRegister: async () => true }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({ ...(await orig<object>()), resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: MANAGER, email: 'grosfeldofer@gmail.com', role: 'runner', roles: ['runner'], isStaff: true, isSuperUser: true, canApprove: true } }) }));

const importRoute = await import('@/app/api/academy/import/route');
const invite = await import('@/app/api/academy/members/invite/route');
const candidates = await import('@/app/api/academy/candidates/route');
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEST_EMAILS } from '@/lib/testing/flows';
import { createImportCard } from '@/lib/testing/actions';
const out = (name: string, v: unknown) => { const d = process.env.QT_OUT; if (!d) return; mkdirSync(d, { recursive: true }); writeFileSync(`${d}/${name}.json`, JSON.stringify(v, null, 1)); };
/** Every path the mails link to must be a page of this app. */
const routeExists = (url: string) => { const p = new URL(url).pathname; const seg = p.split('/').filter(Boolean); const dir = resolve('src/app', ...seg.map((s, i) => (i === 1 && seg[0] === 'join' ? '[token]' : s))); return existsSync(`${dir}/page.tsx`) || existsSync(resolve('src/app', ...seg, 'page.tsx')); };
const register = await import('@/app/api/academy/register/route');

const COACH_Y = uid();
const COACH_S = uid();
const MEMBER = uid();
const BAND_5 = uid();

const call = (method: 'GET' | 'POST' | 'PATCH', body?: unknown) => {
  const req = new Request('http://x/api/academy/import', { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  return (method === 'GET' ? importRoute.GET(req) : method === 'POST' ? importRoute.POST(req) : importRoute.PATCH(req)).then((r) => r.json());
};

const row = (o: Partial<ImportRow> & { key: string; name: string }): ImportRow => ({
  submittedAt: null, email: null, phone: null, coachNick: null, staffNote: null, marked: false, age: null, city: null,
  heightCm: null, weightKg: null, shirtSize: null, shoeSize: null, requestedBand: null, goal: null, runningPast: null,
  achievements: null, medicalHistory: null, medicalDetails: null, hearAbout: null, strava: null, preference: null, sheetResults: null, ...o,
});

const ROWS: ImportRow[] = [
  row({ key: 'r2', name: 'דביר כהנא', email: 'dvir@example.com', phone: '0541234567', coachNick: 'יאיא', staffNote: 'אלדר · בפנים', marked: true,
    city: 'חיפה', heightCm: 186, weightKg: 77, shirtSize: 'L', shoeSize: '44.5', requestedBand: 5, medicalHistory: 'בריא לחלוטין',
    sheetResults: { '5k': 1500, '10k': 2760 } }),
  row({ key: 'r3', name: 'עומר וייס', coachNick: 'סהר' }),          // no email — but the club has an Omer Weiss
  row({ key: 'r4', name: 'נועה ברק', email: 'member@example.com' }), // already in the app by email
  row({ key: 'r5', name: 'גל שחר', email: 'carded@example.com' }),   // already on the funnel
  row({ key: 'r6', name: 'טל רון', coachNick: 'יאיא' }),             // no email, nobody
];

beforeEach(() => {
  mail.form.mockClear(); mail.admin.mockClear(); mail.received.mockClear(); pair.mockClear(); bulk.mockClear(); accept.mockClear(); staffPush.mockClear();
  db = createMemoryDb({
    schema: {
      athletes: ['id', 'coach_id', 'name', 'email', 'phone', 'approved', 'status', 'onboarding_status', 'is_academy', 'created_at', 'strava_auth', 'role', 'extra_roles',
        'invite_token', 'academy_intake', 'height_cm', 'weight_kg', 'shirt_size', 'shoe_size', 'birth_date', 'gender', 'first_seen_at', 'academy_band_id', 'group_id',
        'academy_training_since', 'academy_coach_id'],
      academy_candidates: ['id', 'name', 'email', 'phone', 'source', 'goal', 'athlete_id', 'invite_token', 'invited_at', 'accepted_at', 'archived_at', 'archived_reason', 'intake', 'created_at', 'updated_at'],
      academy_bands: ['id', 'name'],
      academy_candidate_events: ['candidate_id', 'stage', 'recorded_by', 'note', 'occurred_at'],
    },
    unique: { academy_candidate_events: [['candidate_id', 'stage']], academy_candidates: [['athlete_id']] },
    defaults: { athletes: () => ({ id: uid() }), academy_candidates: () => ({ id: uid(), created_at: new Date().toISOString() }) },
  });
  const a = (o: Record<string, unknown>) => ({ coach_id: COACH_ID, email: null, phone: null, approved: true, status: 'active', onboarding_status: null, is_academy: false,
    created_at: '2026-01-01', strava_auth: null, role: 'runner', extra_roles: [], academy_intake: null, first_seen_at: null, ...o });
  db.tables.athletes.push(
    a({ id: COACH_Y, name: 'Yair Gabbay', role: 'coach', extra_roles: ['academy_coach'] }),
    a({ id: COACH_S, name: 'Sahar Azar', role: 'academy_coach' }),
    a({ id: MEMBER, name: 'Omer Weiss' }),
    a({ id: uid(), name: 'Noa Barak', email: 'member@example.com' }),
  );
  db.tables.academy_bands.push({ id: BAND_5, name: 'דבוקה 5' });
  db.tables.academy_candidates.push({ id: uid(), name: 'גל', email: 'carded@example.com', source: 'form', athlete_id: null, invited_at: null, accepted_at: null, archived_at: null, intake: null });
});


describe('flow 2 — a new academy applicant: the form → the manager\'s funnel', () => {
  it('the applicant lands on the funnel with the admin mail and the staff push, and the card is there for the manager', async () => {
    const res = await register.POST(new Request('http://x/api/academy/register', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({
      name: 'Test Academy', email: TEST_EMAILS.academy, phone: '0500000002',
      intake: { firstName: 'Test', lastName: 'Academy', focus: 'שילוב של תכנית און ליין עם מפגשים פיזיים', birthDate: '1990-01-01', weight: '72', height: '178', city: 'Tel Aviv', runningHistory: 'בדיקה', paceGroup: '6', hearAbout: 'אינסטגרם', medicalHistory: 'בריא לחלוטין' },
    }) }));
    expect(res.status).toBe(200);
    expect(mail.admin).toHaveBeenCalledTimes(1);
    expect(mail.received).toHaveBeenCalledTimes(1);
    expect(staffPush).toHaveBeenCalled();
    const board = await (await candidates.GET(new Request('http://x/api/academy/candidates'))).json();
    const card = (board.candidates || board.rows || []).find((c: { email?: string }) => c.email === TEST_EMAILS.academy);
    expect(card).toBeTruthy();
    out('flow2-candidates', board);
  });
});

describe('flow 3 — "כבר מתאמנים": invite → the one-page form → submitted', () => {
  it('mails the details form to the test address with a working link, and the form opens prefilled', async () => {
    const res = await invite.POST(new Request('http://x/api/academy/members/invite', { method: 'POST', body: JSON.stringify({ name: 'Test Movein', email: TEST_EMAILS.movein, phone: '0500000003', coachIds: [COACH_S] }) }));
    expect(res.status).toBe(200);
    out('flow3-invite-res', await res.clone().json());
    expect(mail.form).toHaveBeenCalledTimes(1);
    const sent = mail.form.mock.calls[0][0] as { email: string; url: string };
    expect(sent.email).toBe(TEST_EMAILS.movein);
    expect(sent.url).toMatch(/\/academy-register\?i=/);
    expect(routeExists(sent.url)).toBe(true);
    const token = new URL(sent.url).searchParams.get('i')!;
    const pre = await (await register.GET(new Request(`http://x/api/academy/register?i=${token}`))).json();
    expect(pre.prefill).toMatchObject({ email: TEST_EMAILS.movein });
    out('flow3-prefill', pre);
    // The trainee sends the one page; the card waits for the manager's approval.
    const sentForm = await register.POST(new Request('http://x/api/academy/register', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.8' }, body: JSON.stringify({
      name: 'Test Movein', email: TEST_EMAILS.movein, phone: '0500000003', inviteToken: token,
      intake: { firstName: 'Test', lastName: 'Movein', medicalHistory: 'בריא לחלוטין', hearAbout: 'אינסטגרם' },
    }) }));
    expect(sentForm.status).toBe(200);
    const board = await (await candidates.GET(new Request('http://x/api/academy/candidates'))).json();
    expect(board.candidates.find((c: { email?: string }) => c.email === TEST_EMAILS.movein)).toMatchObject({ source: 'existing' });
    out('flow3-candidates', board);
    expect(pair).toHaveBeenCalledWith(expect.any(String), [COACH_S]);
  });
});

describe('flow 4 — the import test card: invite → "הפרטים שלך" prefilled → confirmed → approved', () => {
  it('the card the tests screen creates is invited through the real move-in invite, and confirming approves it', async () => {
    expect(await createImportCard(db.client as never, MANAGER)).toBe(true);
    const card = db.tables.academy_candidates.find((c) => c.email === TEST_EMAILS.import)!;
    expect(card.source).toBe('import');
    // The coach the tests screen pre-set is the one in the memory roster.
    card.intake._import.coachIds = [COACH_S];
    const board = await call('GET');
    out('flow4-board', board);
    const r = await call('POST', { action: 'invite', cardIds: [card.id] });
    out('flow4-invite-res', r);
    expect(r.results).toEqual([{ cardId: card.id, ok: true, emailed: true }]);
    const sent = mail.form.mock.calls.at(-1)![0] as { email: string; url: string };
    expect(sent.email).toBe(TEST_EMAILS.import);
    expect(routeExists(sent.url)).toBe(true);
    const token = new URL(sent.url).searchParams.get('i')!;
    const pre = await (await register.GET(new Request(`http://x/api/academy/register?i=${token}`))).json();
    expect(pre.prefill?.imported ?? pre.prefill).toBeTruthy();
    out('flow4-prefill', pre);
    out('flow4-board-after', await call('GET'));
  });
});
