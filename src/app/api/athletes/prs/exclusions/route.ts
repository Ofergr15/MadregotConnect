import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { PR_BUCKETS } from '@/lib/prs/pr-buckets';
import { ALL_BUCKETS, tableMissing } from '@/lib/prs/exclusions-store';
import { markClubRecordsStale } from '@/lib/prs/club-records-store';

export const dynamic = 'force-dynamic';

/**
 * POST   /api/athletes/prs/exclusions { athleteId, activityId, bucketKey? }
 * DELETE /api/athletes/prs/exclusions?athleteId=…&activityId=…&bucketKey=…
 *
 * Take a run out of the athlete's records, or put it back, without touching the run
 * (migration 146). `bucketKey` is one distance or '*' (the default) for all of them.
 * Self-or-staff, as for stating a record by hand (/api/athletes/prs PUT): the records
 * are the athlete's to correct, and nobody else's.
 *
 * Until 146 is pasted in, both answer 503 `migration-pending` rather than pretend.
 */

async function parse(request: Request, fromBody: boolean) {
  const src = fromBody
    ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
    : Object.fromEntries(new URL(request.url).searchParams);
  const athleteId = typeof src.athleteId === 'string' ? src.athleteId : '';
  const activityId = typeof src.activityId === 'string' ? src.activityId : '';
  const bucketKey = typeof src.bucketKey === 'string' && src.bucketKey ? src.bucketKey : ALL_BUCKETS;
  return { athleteId, activityId, bucketKey };
}

async function write(request: Request, remove: boolean) {
  try {
    const { athleteId, activityId, bucketKey } = await parse(request, remove);
    if (!athleteId || !activityId) {
      return NextResponse.json({ error: 'athleteId and activityId required' }, { status: 400 });
    }
    if (bucketKey !== ALL_BUCKETS && !PR_BUCKETS.some(b => b.key === bucketKey)) {
      return NextResponse.json({ error: 'unknown bucket', code: 'unknown-bucket' }, { status: 400 });
    }
    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

    const supabase = createServerClient();
    // The run has to be this athlete's: otherwise one id in the body is a way to
    // write a row against somebody else's activity.
    const { data: run } = await supabase
      .from('athlete_activities').select('id').eq('id', activityId).eq('athlete_id', athleteId).maybeSingle();
    if (!run) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });

    const { error } = remove
      ? await supabase.from('athlete_pr_exclusions')
        .upsert({ athlete_id: athleteId, activity_id: activityId, bucket_key: bucketKey }, { onConflict: 'athlete_id,activity_id,bucket_key' })
      // Putting a run back puts it back everywhere it was taken out of: a run taken
      // out "of everything" and then "of the 5K" is one decision to the athlete.
      : await supabase.from('athlete_pr_exclusions').delete()
        .eq('athlete_id', athleteId).eq('activity_id', activityId)
        .in('bucket_key', bucketKey === ALL_BUCKETS ? [ALL_BUCKETS, ...PR_BUCKETS.map(b => b.key)] : [bucketKey, ALL_BUCKETS]);
    if (tableMissing(error)) {
      return NextResponse.json({ error: 'migration 146 not applied', code: 'migration-pending' }, { status: 503 });
    }
    if (error) throw error;

    // The club board and the PR badge read a snapshot; date it back so the next read
    // rebuilds it without this run.
    await markClubRecordsStale(supabase).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('PR exclusion error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) { return write(request, true); }
export async function DELETE(request: Request) { return write(request, false); }
