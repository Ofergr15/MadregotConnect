import { NextResponse } from 'next/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { createMoveInInvite } from '@/lib/academy/move-in-invite';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/academy/members/invite — somebody who ALREADY trains in the academy and is not in
 * the app yet (the migration path, mockup screens 3–4): `{ name, email, phone?, coachIds?,
 * bandId?, groupId?, trainingSince? }`.
 *
 * The same road as a new trainee, without the "who are you" (Ofer, 2026-10-19,
 * academy-onboarding/existing-trainee-flow.html): a row waiting for the form and the
 * approval, with the coaches, the band and the pace group already on it, and a funnel card
 * that says 'existing'. The trainee gets the details form by email; the manager is told the
 * form came back from an existing trainee; accepting (one tap — the coaches are preset)
 * sends the install mail. The email is required: it is how they sign in.
 *
 * Somebody already in the app is not invited — the answer names them, and the move-in tab is
 * the way. Manager only.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireAcademyManager(request);
    if (denied) return denied;
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    const coachIds = Array.isArray(b.coachIds) ? [...new Set(b.coachIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))] : [];
    const since = typeof b.trainingSince === 'string' ? b.trainingSince.trim() : '';
    const result = await createMoveInInvite(caller, {
      name: typeof b.name === 'string' ? b.name : '',
      email: typeof b.email === 'string' ? b.email : '',
      phone: typeof b.phone === 'string' ? b.phone : '',
      coachIds,
      bandId: typeof b.bandId === 'string' && UUID_RE.test(b.bandId) ? b.bandId : null,
      groupId: typeof b.groupId === 'string' && UUID_RE.test(b.groupId) ? b.groupId : null,
      trainingSince: /^\d{4}-\d{2}(-\d{2})?$/.test(since) ? (since.length === 7 ? `${since}-01` : since) : null,
      sendEmail: b.sendEmail !== false,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('POST /api/academy/members/invite error:', error);
    return NextResponse.json({ error: 'Failed to create the invitation' }, { status: 500 });
  }
}
