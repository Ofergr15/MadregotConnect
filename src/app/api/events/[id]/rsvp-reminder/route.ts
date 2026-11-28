import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { israelToday } from '@/lib/utils';
import { isRemindable, reminderCopy, rsvpCounts, unansweredFor } from '@/lib/events/rsvp-reminder';
import { internalErrorBody } from '@/lib/api-error';
import { isMissingColumn } from '@/lib/notifications/seen';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/events/[id]/rsvp-reminder → { dryRun: true, event, counts, unanswered: [{athleteId, name}],
 * remindable, push: { title, body, url } } — task 92. Staff only, behind the default-off flag
 * `event_rsvp_reminder` (404 while off). Data only: it lists who would get a reminder and the
 * push they would get; it never sends. Names only (no email/phone) — the same fields the
 * participant list already shows members.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;
    if (!(await isFeatureEnabled('event_rsvp_reminder', caller.athleteId).catch(() => false))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    }
    const { id } = await params;
    const db = createServerClient();
    // `events.status` comes from 184; without it every event is published (the 184 fallback rule).
    let { data: event, error } = await db.from('events').select('id, name, date, status').eq('id', id).maybeSingle();
    if (isMissingColumn(error)) ({ data: event, error } = await db.from('events').select('id, name, date').eq('id', id).maybeSingle());
    if (error) throw error;
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404, headers: NO_STORE });

    const [{ data: regs, error: rErr }, { data: roster, error: aErr }] = await Promise.all([
      db.from('event_registrations').select('athlete_id, status').eq('event_id', id),
      db.from('athletes').select('id, name, status, role').eq('status', 'active'),
    ]);
    if (rErr) throw rErr;
    if (aErr) throw aErr;
    const registrations = (regs ?? []) as Array<{ athlete_id: string; status: string }>;
    const e = event as { id: string; name: string; date: string; status?: string | null };
    return NextResponse.json({
      dryRun: true,
      event: { id: e.id, name: e.name, date: e.date },
      remindable: isRemindable(e, israelToday()),
      counts: rsvpCounts(registrations),
      unanswered: unansweredFor((roster ?? []) as never, registrations),
      push: { ...reminderCopy('he', { name: e.name, date: e.date }), url: `/dashboard/calendar/${encodeURIComponent(e.id)}` },
    }, { headers: NO_STORE });
  } catch (err) {
    console.error('GET /api/events/[id]/rsvp-reminder failed:', err);
    return NextResponse.json(internalErrorBody(), { status: 500, headers: NO_STORE });
  }
}
