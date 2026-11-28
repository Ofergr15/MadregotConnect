import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { inScope, staffAthleteScope } from '@/lib/academy/staff-scope';
import { addDaysToDateStr, getActivityWeekStart, israelDateAnchor, israelToday } from '@/lib/utils';
import { COACH_ID } from '@/lib/constants';
import { RUNS_ONLY_OR } from '@/lib/activities/kinds';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { waitingCounts, weekByGroup } from '@/lib/admin/manager-week';
import { WAITING_DAYS } from '@/lib/feedback/waiting';
import { PAIN_URGENT_HOURS, REQUEST_URGENT_HOURS, mayReadManagerHome, urgentItems, urgentPain, urgentRequests, type PendingRequest } from '@/lib/admin/urgent';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/manager-home — the "urgent" half of the native manager home v2 (direction C): which pain reports
 * and join requests have waited past the line (lib/admin/urgent.ts), by name, so the hero can say who.
 * Two count blocks for the native screens sit next to it (lib/admin/manager-week.ts, task 150):
 *   waiting   — "מחכה לך עכשיו": join requests, runners with unanswered pain, unpaid store orders (admin /
 *               super user only; null for an academy manager, who has no finance screen).
 *   week      — "השבוע לפי קבוצה": per pack, members who ran this activity week (Monday) and who not yet.
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
    const seesMoney = caller.isSuperUser || caller.role === 'admin' || !!caller.roles?.includes('admin');
    const weekStart = getActivityWeekStart(israelDateAnchor());
    const weekEnd = addDaysToDateStr(weekStart, 7);
    const [scope, fb, reqs, roster, groups, unpaid, ranRows] = await Promise.all([
      staffAthleteScope(db, caller),
      db.from('workout_feedback').select('id, athlete_id, created_at, pain, wants_feedback, comment, coach_reply_at')
        .gte('created_at', since).eq('pain', true),
      db.from('signup_requests').select('id, created_at, athlete_id, full_name').eq('status', 'pending').neq('source', 'club-backfill'),
      db.from('athletes').select('id, group_id').eq('coach_id', COACH_ID).eq('status', 'active').or('role.is.null,role.neq.admin'),
      db.from('groups').select('id, name').eq('coach_id', COACH_ID),
      seesMoney
        ? db.from('store_orders').select('id, created_at').eq('status', 'pending_payment')
        : Promise.resolve({ data: null, error: null }),
      // start_time is the runner's wall clock in a UTC-shaped column (CLAUDE.md), so the
      // Monday window is compared in those same UTC-shaped terms. Runs only; strength is not "ran".
      fetchAllRows<{ athlete_id: string }>((from, to) => db.from('athlete_activities').select('athlete_id')
        .gte('start_time', `${weekStart}T00:00:00Z`).lt('start_time', `${weekEnd}T00:00:00Z`)
        .or(RUNS_ONLY_OR).range(from, to))
        .then((data) => ({ data, error: null }), (error: { message?: string }) => ({ data: null, error })),
    ]);
    // A failed read is an error, never "quiet" — an empty urgent list would tell the manager nobody is in pain.
    const failed = fb.error ?? reqs.error ?? roster.error ?? groups.error ?? unpaid.error ?? ranRows.error;
    if (failed) {
      console.error('manager-home read failed:', failed.message);
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
    const painRows = rows.map((r) => ({
      id: r.id, athleteId: r.athlete_id, createdAt: r.created_at, pain: r.pain, wantsFeedback: r.wants_feedback,
      comment: r.comment, coachReplyAt: r.coach_reply_at, messages: thread.get(r.id) ?? [],
    }));
    const pain = urgentPain(painRows, names, now);
    const pending: PendingRequest[] = reqRows.map((r) => ({
      id: r.id, createdAt: r.created_at, athleteId: r.athlete_id,
      fullName: r.full_name ?? (r.athlete_id ? names.get(r.athlete_id) ?? null : null),
      approved: !!r.athlete_id && approved.has(r.athlete_id),
    }));
    const unpaidRows = ((unpaid.data ?? []) as Array<{ id: string; created_at: string }>).map((o) => ({ id: o.id, createdAt: o.created_at }));
    const counts = waitingCounts(painRows, pending, unpaidRows, now);
    const members = ((roster.data ?? []) as Array<{ id: string; group_id: string | null }>).map((m) => ({ id: m.id, groupId: m.group_id }));
    return NextResponse.json({
      urgent: urgentItems(pain, urgentRequests(pending, now)),
      waiting: seesMoney ? counts : { ...counts, unpaid: null, total: counts.join + counts.pain, oldestDays: { ...counts.oldestDays, unpaid: null } },
      week: weekByGroup(weekStart, members, (groups.data ?? []) as Array<{ id: string; name: string | null }>, ((ranRows.data ?? []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id)),
      rules: { painHours: PAIN_URGENT_HOURS, requestHours: REQUEST_URGENT_HOURS, lateCoach: false },
      at: now,
    });
  } catch (error) {
    console.error('manager-home error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
