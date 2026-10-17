import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { loadMigrationBoard } from '@/lib/academy/migration-server';
import { notifyAthlete } from '@/lib/push';
import { academyMoveInNudgeCopy } from '@/lib/notifications/copy';
import { testRequestCopy } from '@/lib/academy/test-request';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/academy/migration/remind — `{ athleteIds? }` (default: everybody stuck). One push
 * each, for the step they are actually at, read again here rather than trusted from the client:
 * connect the watch, the test, or the four questions. Somebody who has not opened their link
 * has no app to push to — the board sends that one on WhatsApp instead — and the coach's steps
 * are the coach's queue, not a reminder to the trainee.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireAcademyManager(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({})) as { athleteIds?: unknown };
    const only = Array.isArray(body.athleteIds) ? new Set(body.athleteIds.filter((x): x is string => typeof x === 'string')) : null;
    const rows = (await loadMigrationBoard(createServerClient(), israelToday()))
      .filter((r) => (only ? only.has(r.athleteId) : r.stuck) && r.owner === 'trainee' && ['watch', 'test', 'questions'].includes(r.step));
    const today = israelToday();
    const results = await Promise.allSettled(rows.map((r) => notifyAthlete({
      athleteId: r.athleteId,
      kind: r.step === 'test' ? 'academy_test_request' : 'academy_move_in_nudge',
      actorAthleteId: caller.athleteId,
      copy: (locale) => (r.step === 'test' ? testRequestCopy(locale, {}) : academyMoveInNudgeCopy(locale, { step: r.step as 'watch' | 'questions' })),
      url: r.step === 'watch' ? '/dashboard/profile?tab=datasource' : r.step === 'test' ? '/dashboard/academy?test=entry' : '/dashboard/academy',
      // One a day per trainee, whatever the step: a second tap the same day replaces the first.
      tag: `academy-move-in-${r.athleteId}-${today}`,
    })));
    return NextResponse.json({ reminded: results.filter((x) => x.status === 'fulfilled').length, athleteIds: rows.map((r) => r.athleteId) });
  } catch (err) {
    console.error('POST /api/academy/migration/remind error:', err);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}
