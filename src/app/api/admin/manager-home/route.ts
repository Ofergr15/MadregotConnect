import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { inScope, staffAthleteScope } from '@/lib/academy/staff-scope';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { WAITING_DAYS } from '@/lib/feedback/waiting';
import { PAIN_URGENT_HOURS, REQUEST_URGENT_HOURS, mayReadManagerHome, urgentItems, urgentPain, urgentRequests, type PendingRequest } from '@/lib/admin/urgent';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/manager-home — the "urgent" half of the native manager home v2 (direction C): which pain reports
 * and join requests have waited past the line (lib/admin/urgent.ts), by name, so the hero can say who.
 * The counts of everything else stay where they are (needs-you, staff/attention, coach/volume).
 *
 * Admin / academy manager / super user only (mayReadManagerHome) — names of people in pain are not for every coach.
 * Pain is scoped like staff/attention (staffAthleteScope). Names only; never an email, phone or the pain text.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayReadManagerHome(caller)) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const db = createServerClient();
    const since = `${addDaysToDateStr(israelToday(), -WAITING_DAYS)}T00:00:00Z`;
    const [scope, fb, reqs] = await Promise.all([
      staffAthleteScope(db, caller),
      db.from('workout_feedback').select('id, athlete_id, created_at, pain, wants_feedback, comment, coach_reply_at')
        .gte('created_at', since).eq('pain', true),
      db.from('signup_requests').select('id, created_at, athlete_id, full_name').eq('status', 'pending').neq('source', 'club-backfill'),
    ]);
    // A failed read is an error, never "quiet" — an empty urgent list would tell the manager nobody is in pain.
    if (fb.error || reqs.error) {
      console.error('manager-home read failed:', fb.error?.message ?? reqs.error?.message);
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
    }

    type Fb = { id: string; athlete_id: string; created_at: string; pain: boolean | null; wants_feedback: boolean | null; comment: string | null; coach_reply_at: string | null };
    const rows = inScope((fb.data ?? []) as Fb[], scope, (r) => r.athlete_id);
    // Only the threads of these pain reports — a club-wide 14-day read would hit the 1000-row cap.
    const msgs = rows.length
      ? await db.from('workout_feedback_messages').select('feedback_id, sender_athlete_id, created_at')
        .in('feedback_id', rows.map((r) => r.id)).gte('created_at', since)
      : { data: [], error: null };
    if (msgs.error) {
      console.error('manager-home messages read failed:', msgs.error.message);
      return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
    }
    const owner = new Map(rows.map((r) => [r.id, r.athlete_id]));
    const thread = new Map<string, Array<{ createdAt: string; fromStaff: boolean }>>();
    for (const m of (msgs.data ?? []) as Array<{ feedback_id: string; sender_athlete_id: string; created_at: string }>) {
      if (!owner.has(m.feedback_id)) continue;
      thread.set(m.feedback_id, [...(thread.get(m.feedback_id) ?? []), { createdAt: m.created_at, fromStaff: m.sender_athlete_id !== owner.get(m.feedback_id) }]);
    }
    const reqRows = (reqs.data ?? []) as Array<{ id: string; created_at: string; athlete_id: string | null; full_name?: string | null }>;
    const ids = [...new Set([...rows.map((r) => r.athlete_id), ...reqRows.map((r) => r.athlete_id).filter((x): x is string => !!x)])];
    const athRead = ids.length ? await db.from('athletes').select('id, name, approved').in('id', ids) : { data: [], error: null };
    if (athRead.error) return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
    const ath = athRead.data;
    const athletes = (ath ?? []) as Array<{ id: string; name: string | null; approved: boolean | null }>;
    const names = new Map(athletes.map((a) => [a.id, a.name ?? '—']));
    const approved = new Set(athletes.filter((a) => a.approved === true).map((a) => a.id));

    const now = new Date().toISOString();
    const pain = urgentPain(rows.map((r) => ({
      id: r.id, athleteId: r.athlete_id, createdAt: r.created_at, pain: r.pain, wantsFeedback: r.wants_feedback,
      comment: r.comment, coachReplyAt: r.coach_reply_at, messages: thread.get(r.id) ?? [],
    })), names, now);
    const pending: PendingRequest[] = reqRows.map((r) => ({
      id: r.id, createdAt: r.created_at, athleteId: r.athlete_id,
      fullName: r.full_name ?? (r.athlete_id ? names.get(r.athlete_id) ?? null : null),
      approved: !!r.athlete_id && approved.has(r.athlete_id),
    }));
    return NextResponse.json({
      urgent: urgentItems(pain, urgentRequests(pending, now)),
      rules: { painHours: PAIN_URGENT_HOURS, requestHours: REQUEST_URGENT_HOURS, lateCoach: false },
      at: now,
    });
  } catch (error) {
    console.error('manager-home error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
