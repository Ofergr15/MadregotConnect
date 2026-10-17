import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isPendingAthlete, seesPending } from '@/lib/auth/pending-athletes';
import {
  computeDistanceBests, filterQualifyingRuns, PR_BUCKETS, UNMEASURED_RUN_TYPES, type RunActivityRow,
} from '@/lib/prs/pr-buckets';
import { attachLapsForPrs } from '@/lib/prs/attach-laps';
import { realBreaks, recordBreaks } from '@/lib/prs/record-history';
import { ALL_BUCKETS, readPrExclusions, type PrExclusions } from '@/lib/prs/exclusions-store';
import { fetchAllRows } from '@/lib/supabase/paginate';

export const dynamic = 'force-dynamic';

/**
 * GET /api/athletes/[id]/records/run/[activityId] — the records one run set.
 *
 * The run page's "השיאים בריצה הזו": for each distance this run broke the record at
 * (a break in that record's history, lib/prs/record-history.ts), its time, whether it
 * is still the record, and — so the confirmation can say exactly what removing it
 * does — the record that would stand without it. Plus the distances the athlete
 * already took it out of, so the page can offer to put it back.
 *
 * Gated like /stats (any club member sees a teammate's records); the remove buttons
 * are the owner's, and the write route enforces that on its own.
 */
export interface RunRecord {
  bucket: string;
  seconds: number;
  current: boolean;
  /** The record without this run; null when nothing else qualifies. */
  instead: { seconds: number; date: string; activityId: string | null } | null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  try {
    const { id, activityId } = await params;
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const supabase = createServerClient();
    if (!seesPending(caller, id) && (await isPendingAthlete(supabase, id))) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });
    }

    const acts = await fetchAllRows<RunActivityRow>((from, to) =>
      supabase
        .from('athlete_activities')
        .select('id, activity_name, activity_type, start_time, distance, duration')
        .eq('athlete_id', id)
        .order('start_time', { ascending: false })
        .order('id')
        .range(from, to),
    );
    const run = acts.find(a => a.id === activityId);
    if (!run) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });

    const excluded = await readPrExclusions(supabase, id);
    const excludedFrom = [...(excluded.get(activityId) ?? [])]
      .filter(k => k === ALL_BUCKETS || PR_BUCKETS.some(b => b.key === k));
    // A treadmill run never holds a record (pr-buckets.ts), and the page says why.
    const unmeasured = !!run.activity_type && UNMEASURED_RUN_TYPES.includes(run.activity_type);
    if (unmeasured) return NextResponse.json({ unmeasured, records: [], excludedFrom });

    const runs = await attachLapsForPrs(supabase, id, filterQualifyingRuns(acts));
    const bests = computeDistanceBests(runs, { excluded });
    const records: RunRecord[] = [];
    for (const b of PR_BUCKETS) {
      const mine = realBreaks(recordBreaks(runs, b.key, excluded)).find(h => h.activityId === activityId);
      if (!mine) continue;
      // The same calculation with this run taken out of this distance.
      const without: PrExclusions = new Map(excluded);
      without.set(activityId, new Set([...(excluded.get(activityId) ?? []), b.key]));
      const alt = computeDistanceBests(runs, { excluded: without }).find(x => x.key === b.key);
      records.push({
        bucket: b.key,
        seconds: mine.seconds,
        current: bests.find(x => x.key === b.key)?.activityId === activityId,
        instead: alt?.seconds != null && alt.date ? { seconds: alt.seconds, date: alt.date, activityId: alt.activityId } : null,
      });
    }
    return NextResponse.json({ unmeasured, records, excludedFrom });
  } catch (error: any) {
    console.error('Run records error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
