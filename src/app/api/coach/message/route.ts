import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { notifyAthlete } from '@/lib/push';
import { coachMessageCopy } from '@/lib/notifications/copy';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const MAX_LEN = 1000;

// POST /api/coach/message  { athleteId, text }
//
// Staff → one runner: a push plus a durable inbox row (kind `coach_message`,
// category `coach`, so the runner's own "מהמאמן" toggle governs it). Staff-only
// from the verified session; the sender is the caller, never a body field. It is
// a one-way note — there is no reply thread here; the runner answers through the
// channels they already have. Recipient must be an athlete of this club.
export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body?.athleteId === 'string' ? body.athleteId : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!athleteId || !text) return NextResponse.json({ error: 'athleteId and text are required' }, { status: 400 });
    if (text.length > MAX_LEN) return NextResponse.json({ error: `text is limited to ${MAX_LEN} characters` }, { status: 400 });

    const db = createServerClient();
    const [{ data: target }, { data: sender }] = await Promise.all([
      db.from('athletes').select('id').eq('id', athleteId).maybeSingle(),
      caller.athleteId
        ? db.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!target) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    const coachName = ((sender as any)?.name || 'המאמן').trim();

    const result = await notifyAthlete({
      athleteId,
      kind: 'coach_message',
      url: '/dashboard/notifications',
      tag: `coach-message-${athleteId}-${Date.now()}`,
      category: 'coach',
      actorAthleteId: caller.athleteId,
      copy: (locale) => coachMessageCopy(locale, { coachName, text }),
    });
    return NextResponse.json({ sent: true, result });
  } catch (error: any) {
    console.error('[coach/message] failed:', error);
    return NextResponse.json(internalErrorBody('Failed to send'), { status: 500 });
  }
}
