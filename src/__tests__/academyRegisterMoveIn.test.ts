import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { COACH_ID } from '@/lib/constants';

/**
 * The move-in form, re-sent or edited (2026-10-19 readiness check):
 *   - the personal link's CARD decides whose row this is: a trainee who corrects the
 *     pre-filled email updates their own pending row, never a second one;
 *   - once accepted (approved), sending the form again only refreshes details — it never
 *     resets the row to approved:false / invited.
 */

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
vi.mock('@/lib/email', () => ({ notifyAdminNewAcademyRegistration: vi.fn(), notifyAcademyFormReceived: vi.fn() }));
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn(async () => ({ recipients: 0, sent: 0 })), academyManagerIds: async () => [] }));
vi.mock('@/lib/academy/intake-server', () => ({ recordFormCandidate: async () => 'card-1', invitePrefill: async () => null }));
vi.mock('@/lib/academy/link-server', () => ({ likelyClubMember: async () => null }));
vi.mock('@/lib/academy/registration', () => ({ mayRegister: async () => true }));

const { POST } = await import('@/app/api/academy/register/route');
const TOKEN = 'b'.repeat(32);
const ROW = uid();
let ip = 0;
const post = (body: Record<string, unknown>) => POST(new Request('https://x/api/academy/register', {
  method: 'POST', headers: { 'x-forwarded-for': `10.9.0.${++ip}` },
  body: JSON.stringify({ name: 'Roni Gur', phone: '0501111111', inviteToken: TOKEN, ...body }),
}));

beforeEach(() => {
  db = createMemoryDb({
    schema: {
      athletes: ['id', 'coach_id', 'name', 'email', 'phone', 'status', 'is_academy', 'role', 'approved', 'onboarding_status', 'invite_token', 'academy_intake'],
      academy_candidates: ['id', 'athlete_id', 'invite_token', 'source'],
    },
    defaults: { athletes: () => ({ id: uid() }) },
  });
  // As members/invite leaves a move-in: a pending row with the address the manager typed.
  db.tables.athletes.push({ id: ROW, coach_id: COACH_ID, name: 'Roni Gur', email: 'roni@old.example', phone: null, status: 'invited', is_academy: true, role: 'academy_user', approved: false, onboarding_status: 'academy_pending', invite_token: 'join-1', academy_intake: null });
  db.tables.academy_candidates.push({ id: 'card-1', athlete_id: ROW, invite_token: TOKEN, source: 'existing' });
});

describe('the move-in form', () => {
  it('an edited email updates the card\'s own row — no second pending athlete', async () => {
    expect((await post({ email: 'roni@new.example' })).status).toBe(200);
    expect(db.tables.athletes).toHaveLength(1);
    expect(db.tables.athletes[0]).toMatchObject({ id: ROW, email: 'roni@new.example', invite_token: 'join-1', approved: false });
  });

  it('after accept, sending it again refreshes details and keeps the accept', async () => {
    Object.assign(db.tables.athletes[0], { approved: true, status: 'active' });
    expect((await post({ email: 'roni@old.example', phone: '0502222222' })).status).toBe(200);
    expect(db.tables.athletes).toHaveLength(1);
    expect(db.tables.athletes[0]).toMatchObject({ approved: true, status: 'active', role: 'academy_user', phone: '0502222222' });
  });

  it('without a token, the old rule: matched by email, else a new applicant', async () => {
    expect((await post({ inviteToken: undefined, email: 'someone@else.example' })).status).toBe(200);
    expect(db.tables.athletes).toHaveLength(2);
  });
});
