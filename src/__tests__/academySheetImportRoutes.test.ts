import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';
import { cleanRows, type ImportRow } from '@/lib/academy/sheet-import';

/**
 * The academy's file → the app, the server half, on an in-memory database: the preview writes
 * and sends nothing, the import opens cards that nobody hears about, an invitation is the
 * existing move-in invite (with the file's details on the row), and the trainee's confirmation
 * is the approval. Synthetic people only.
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
vi.mock('@/lib/academy/pairing-server', () => ({
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

const importRoute = await import('@/app/api/academy/import/route');
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
      academy_candidates: ['id', 'name', 'email', 'phone', 'source', 'athlete_id', 'invite_token', 'invited_at', 'accepted_at', 'archived_at', 'archived_reason', 'intake', 'created_at', 'updated_at'],
      academy_bands: ['id', 'name'],
      academy_candidate_events: ['candidate_id', 'stage', 'recorded_by', 'note'],
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

describe('preview — who each row already is, nothing written or sent', () => {
  it('ready, no email, in the app, a club member across scripts, already on the funnel', async () => {
    const before = JSON.stringify(db.tables);
    const p = await call('POST', { action: 'preview', rows: ROWS });
    expect(p.ready).toEqual(['r2']);
    const kind = Object.fromEntries(p.needs.map((n: { key: string; kind: string }) => [n.key, n.kind]));
    expect(kind).toEqual({ r3: 'club_member', r4: 'in_app', r5: 'has_card', r6: 'no_email' });
    expect(p.needs.find((n: { key: string }) => n.key === 'r3')).toMatchObject({ athleteId: MEMBER, member: true });
    expect(p.coaches.map((c: { name: string }) => c.name)).toEqual(['Sahar Azar', 'Yair Gabbay']);
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(mail.form).not.toHaveBeenCalled();
  });
});

describe('commit — one card per row, NOT invited, nobody told', () => {
  it('opens the cards with the prefill, the results and the staff block; links the club member; skips', async () => {
    const r = await call('POST', { action: 'commit', rows: ROWS, coachMap: { 'יאיא': COACH_Y, 'סהר': COACH_S }, links: { r3: MEMBER }, skip: ['r4', 'r5'] });
    expect(r).toEqual({ created: 2, linked: 1, skipped: 2 });
    const cards = db.tables.academy_candidates.filter((c) => c.source === 'import');
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(c.invited_at ?? null).toBeNull();
    const dvir = cards.find((c) => c.email === 'dvir@example.com')!;
    expect(dvir.intake.imported).toMatchObject({ city: 'חיפה', height: 186, shirtSize: 'L' });
    expect(dvir.intake.sheet_results).toEqual({ '5k': 1500, '10k': 2760 });
    expect(dvir.intake._import).toMatchObject({ coachIds: [COACH_Y], requestedBandId: BAND_5, staffNote: 'אלדר · בפנים', importedBy: { athleteId: MANAGER } });
    expect(cards.find((c) => c.name === 'עומר וייס')!.athlete_id).toBe(MEMBER);
    expect(mail.form).not.toHaveBeenCalled();
    expect(pair).not.toHaveBeenCalled();
  });
  it('a column the parser would never keep cannot be stored through a hand-made request', async () => {
    await call('POST', { action: 'commit', rows: [{ ...ROWS[0], bloodTests: 'SECRET-BLOOD', instagram: 'SECRET-IG', familyStatus: 'SECRET-FAM' }], coachMap: {}, links: {}, skip: [] });
    const all = JSON.stringify(db.tables.academy_candidates);
    for (const s of ['SECRET-BLOOD', 'SECRET-IG', 'SECRET-FAM']) expect(all).not.toContain(s);
  });
});

describe('invite — the move-in invitation, per person', () => {
  const commitAll = () => call('POST', { action: 'commit', rows: cleanRows(ROWS), coachMap: { 'יאיא': COACH_Y, 'סהר': COACH_S }, links: { r3: MEMBER }, skip: ['r4', 'r5'] });

  it('mails the details form, presets the coach, and puts the file\'s details on the row', async () => {
    await commitAll();
    const card = db.tables.academy_candidates.find((c) => c.email === 'dvir@example.com')!;
    const r = await call('POST', { action: 'invite', cardIds: [card.id] });
    expect(r.results).toEqual([{ cardId: card.id, ok: true, emailed: true }]);
    const athlete = db.tables.athletes.find((x) => x.email === 'dvir@example.com')!;
    expect(athlete).toMatchObject({ approved: false, onboarding_status: 'academy_pending', is_academy: true, height_cm: 186, weight_kg: 77, shirt_size: 'L', shoe_size: '44.5' });
    expect(athlete.academy_intake).toEqual({ sheet_results: { '5k': 1500, '10k': 2760 } });
    expect(pair).toHaveBeenCalledWith(athlete.id, [COACH_Y]);
    const after = db.tables.academy_candidates.find((c) => c.id === card.id)!;
    expect(after).toMatchObject({ source: 'existing', athlete_id: athlete.id, invited_at: expect.any(String) });
    expect(after.invite_token).toMatch(/^[0-9a-f]{32}$/);
    expect(after.intake._import.invitedBy).toEqual({ athleteId: MANAGER, email: 'manager@example.com' });
    expect(db.tables.academy_candidates.filter((c) => c.athlete_id === athlete.id)).toHaveLength(1); // the import's card, not a second one
    expect(mail.form).toHaveBeenCalledTimes(1);
  });
  it('a club member the import linked is moved in as one — no second account', async () => {
    await commitAll();
    const card = db.tables.academy_candidates.find((c) => c.athlete_id === MEMBER)!;
    const r = await call('POST', { action: 'invite', cardIds: [card.id] });
    expect(r.results[0]).toMatchObject({ ok: true, moved: true });
    expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'add', existing: true, athleteIds: [MEMBER], coachIds: [COACH_S] }), expect.anything());
    expect(db.tables.athletes.filter((x) => x.name === 'Omer Weiss')).toHaveLength(1);
    expect(mail.form).not.toHaveBeenCalled();
  });
  it('no email: refused, and the address can be added', async () => {
    await commitAll();
    const card = db.tables.academy_candidates.find((c) => c.name === 'טל רון')!;
    expect((await call('POST', { action: 'invite', cardIds: [card.id] })).results[0]).toMatchObject({ ok: false, error: 'no_email' });
    expect(await call('PATCH', { cardId: card.id, email: 'Tal@Example.com' })).toEqual({ ok: true, email: 'tal@example.com' });
    expect((await call('POST', { action: 'invite', cardIds: [card.id] })).results[0]).toMatchObject({ ok: true });
  });
  it('never twice', async () => {
    await commitAll();
    const card = db.tables.academy_candidates.find((c) => c.email === 'dvir@example.com')!;
    await call('POST', { action: 'invite', cardIds: [card.id] });
    expect((await call('POST', { action: 'invite', cardIds: [card.id] })).results[0]).toMatchObject({ ok: false, error: 'already_invited' });
    expect(mail.form).toHaveBeenCalledTimes(1);
  });
});

describe('the trainee confirms — and that is the approval', () => {
  it('the prefill, without anything staff-only; the answers on the row; accepted as the inviter', async () => {
    await call('POST', { action: 'commit', rows: ROWS, coachMap: { 'יאיא': COACH_Y }, links: {}, skip: ['r3', 'r4', 'r5', 'r6'] });
    const card = db.tables.academy_candidates.find((c) => c.email === 'dvir@example.com')!;
    await call('POST', { action: 'invite', cardIds: [card.id] });
    const token = db.tables.academy_candidates.find((c) => c.id === card.id)!.invite_token;

    const pre = await (await register.GET(new Request(`http://x/api/academy/register?i=${token}`))).json();
    expect(pre.prefill).toMatchObject({ existing: true, imported: true, email: 'dvir@example.com', fields: { city: 'חיפה', height: '186', shirtSize: 'L' } });
    const seen = JSON.stringify(pre);
    for (const hidden of ['אלדר', 'בפנים', 'Yair', '_import', 'sheet_results']) expect(seen).not.toContain(hidden);

    const res = await register.POST(new Request('http://x/api/academy/register', {
      method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ name: 'דביר כהנא', email: 'dvir@example.com', phone: '0541234567', inviteToken: token,
        intake: { firstName: 'דביר', lastName: 'כהנא', city: 'חיפה', height: '187', weight: '76', birthDate: '1995-03-04', gender: 'גבר', stillHealthy: 'כן', medicalHistory: 'בריא לחלוטין', shirtSize: 'L', shoeSize: '44.5' } }),
    }));
    expect(res.status).toBe(200);
    const athlete = db.tables.athletes.find((x) => x.email === 'dvir@example.com')!;
    expect(athlete).toMatchObject({ height_cm: 187, weight_kg: 76, birth_date: '1995-03-04', gender: 'male', shirt_size: 'L', shoe_size: '44.5' });
    expect(athlete.academy_intake.sheet_results).toEqual({ '5k': 1500, '10k': 2760 }); // the coach's, kept
    expect(athlete.academy_intake.firstName).toBe('דביר');
    const after = db.tables.academy_candidates.find((c) => c.id === card.id)!;
    expect(after.intake._import).toBeTruthy();
    expect(after.intake.sheet_results).toEqual({ '5k': 1500, '10k': 2760 });
    expect(accept).toHaveBeenCalledWith(card.id, expect.objectContaining({ athleteId: MANAGER, role: 'academy_manager' }), {});
    // No "waiting for your approval" — the accept sends the install mail and tells the coach.
    expect(mail.admin).not.toHaveBeenCalled();
    expect(mail.received).not.toHaveBeenCalled();
    expect(staffPush).not.toHaveBeenCalled();
  });
  it('an ordinary move-in card is not auto-accepted', async () => {
    const athleteId = uid();
    db.tables.athletes.push({ id: athleteId, coach_id: COACH_ID, name: 'x', email: 'plain@example.com', approved: false, status: 'invited', onboarding_status: 'academy_pending', is_academy: true, invite_token: 'a'.repeat(32), academy_intake: null });
    const token = 'b'.repeat(32);
    db.tables.academy_candidates.push({ id: uid(), name: 'x', email: 'plain@example.com', source: 'existing', athlete_id: athleteId, invite_token: token, invited_at: new Date().toISOString(), accepted_at: null, archived_at: null, intake: null });
    await register.POST(new Request('http://x/api/academy/register', { method: 'POST', headers: { 'x-forwarded-for': '1.2.3.5' },
      body: JSON.stringify({ name: 'Plain Person', email: 'plain@example.com', inviteToken: token, intake: { firstName: 'Plain', medicalHistory: 'בריא לחלוטין' } }) }));
    expect(accept).not.toHaveBeenCalled();
    expect(mail.admin).toHaveBeenCalledTimes(1);
  });
});

describe('the board — where each one is', () => {
  it('not invited, invited; the staff note stays staff-side', async () => {
    await call('POST', { action: 'commit', rows: ROWS, coachMap: { 'יאיא': COACH_Y }, links: {}, skip: ['r3', 'r4', 'r5'] });
    const card = db.tables.academy_candidates.find((c) => c.email === 'dvir@example.com')!;
    await call('POST', { action: 'invite', cardIds: [card.id] });
    const b = await call('GET');
    const by = Object.fromEntries(b.rows.map((r: { name: string; stage: string }) => [r.name, r]));
    expect(by['דביר כהנא']).toMatchObject({ stage: 'invited', coachNames: ['Yair Gabbay'], requestedBand: 5, marked: true, hasResults: true });
    expect(by['טל רון']).toMatchObject({ stage: 'not_invited', email: null });
  });
});
