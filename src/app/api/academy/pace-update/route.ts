import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { addDaysToDateStr, israelToday, planWeekStartOf } from '@/lib/utils';
import { requireTraineeAccess } from '@/lib/academy/pairing-server';
import { buildCoachTools } from '@/lib/academy/coach-tools-build';
import { activeAdjust, addAdjust, adjustFor } from '@/lib/academy/coach-tools';
import { recordDecision, reresolveFuturePlans } from '@/lib/academy/coach-tools-server';
import type { PaceUpdateResponse } from '@/lib/academy/coach-tools-payload';

export const dynamic = 'force-dynamic';
// Re-sending the planned weeks that are already on the watch: a few Garmin calls per week.
export const maxDuration = 120;

/**
 * POST /api/academy/pace-update { athleteId, action: 'apply' | 'half' | 'snooze' }
 * — the three buttons of the pace suggestion (mockup phone 2).
 *
 *   apply   "לעדכן את הקצבים": the proposed change, per kind that moved.
 *   half    "חצי מזה": half of it, toward zero.
 *   snooze  "לא עכשיו": quiet for 14 days (until a new test, which resets everything).
 *
 * The suggestion is RECOMPUTED here from the same reads the home used, and the change is
 * taken from that — never from numbers in the body. An update takes effect from next
 * week: every stored plan week from then on is re-resolved (idempotent, see
 * `applyPaceAdjust`) and the sessions already on the watch are sent again. The decision is
 * recorded (migration 141) with its evidence, which is what the trainee's card prints.
 *
 * WHO: `requireTraineeAccess` — the manager, or one of the trainee's own coaches.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body?.athleteId === 'string' ? body.athleteId.trim() : '';
    const action = body?.action;
    if (!athleteId || !['apply', 'half', 'snooze'].includes(action)) {
      return NextResponse.json({ error: 'athleteId and action (apply | half | snooze) are required' }, { status: 400 });
    }
    const { denied, caller } = await requireTraineeAccess(request, athleteId);
    if (denied) return denied;

    const supabase = createServerClient();
    const tools = await buildCoachTools(supabase, [athleteId], { withMissedKm: false });
    const sug = tools.pace.find(p => p.athleteId === athleteId);
    const basis = tools.context.basis[athleteId];
    if (!sug || !basis) {
      return NextResponse.json({ ok: false, stored: tools.stored, action, error: 'no-suggestion' } satisfies PaceUpdateResponse, { status: 409 });
    }

    if (action === 'snooze') {
      const stored = await recordDecision(supabase, {
        athleteId, coachId: caller.athleteId, kind: 'pace', action: 'snooze',
        basisTestDate: basis.testDate, weekStart: null,
      });
      return NextResponse.json({ ok: true, stored, action } satisfies PaceUpdateResponse);
    }

    const changes = adjustFor(sug, action);
    const active = activeAdjust(tools.context.decisions.filter(d => d.athleteId === athleteId), basis.testDate);
    const target = addAdjust(active.adjust, changes);
    const today = israelToday();
    const fromWeek = addDaysToDateStr(planWeekStartOf(today), 7);

    const lead = sug.kinds[0];
    const stored = await recordDecision(supabase, {
      athleteId,
      coachId: caller.athleteId,
      kind: 'pace',
      action,
      basisTestDate: basis.testDate,
      weekStart: fromWeek,
      changes,
      evidence: {
        direction: lead.direction,
        moved: lead.moved,
        of: lead.sessions.length,
        kinds: sug.kinds.map(k => ({
          kind: k.kind,
          fromSec: sug.current[k.kind] ?? k.currentSec,
          toSec: (sug.current[k.kind] ?? k.currentSec) + (changes[k.kind] ?? 0),
          moved: k.moved,
          of: k.sessions.length,
          hr: k.hr,
          sessions: k.sessions,
        })),
      },
    });

    const resolved = await reresolveFuturePlans(supabase, {
      athleteId, fromWeek, thresholdSec: basis.thresholdSec, target, today, cleanDayOnce: caller.isSuperUser,
    });
    return NextResponse.json({
      ok: true, stored, action, changes, fromWeek, weeks: resolved.weeks, sent: resolved.sent,
    } satisfies PaceUpdateResponse);
  } catch (error) {
    console.error('pace-update error:', error);
    return NextResponse.json({ error: 'Failed to update the paces' }, { status: 500 });
  }
}
