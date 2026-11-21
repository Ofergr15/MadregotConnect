import type { createServerClient } from '@/lib/supabase/server';
import { israelToday } from '@/lib/utils';
import { isFeatureEnabled } from '@/lib/features/server';
import { readRoster } from './server';
import { newClubRecords, clubRecordBody, CLUB_RECORD_KIND, type BucketLike } from './club-record-card';

/**
 * Post one card per record that fell between `before` and `after`. Best effort:
 * never throws (a failed card must not fail the records page). Deduped on
 * (bucket, activity) so two overlapping recomputes post once. Gated rollout: only
 * when `records_tab` is on for the holder — a card about a tab nobody has is noise.
 */
export async function postClubRecordCards(
  db: ReturnType<typeof createServerClient>,
  before: BucketLike[] | null,
  after: BucketLike[],
): Promise<number> {
  try {
    if (!before) return 0;
    const roster = await readRoster(db, israelToday());
    const fresh = newClubRecords(before, after, new Map(roster.map((p) => [p.id, p])));
    let posted = 0;
    for (const rec of fresh) {
      if (!(await isFeatureEnabled('records_tab', rec.athleteId, db))) continue;
      const { data: prior } = await db.from('feed_items').select('id')
        .eq('type', 'achievement').eq('payload->>kind', CLUB_RECORD_KIND)
        .eq('payload->>bucketKey', rec.bucketKey).eq('payload->>athleteId', rec.athleteId)
        .eq('payload->>seconds', String(rec.seconds)).limit(1);
      if (prior?.length) continue;
      const { error } = await db.from('feed_items').insert({
        type: 'achievement', author_athlete_id: rec.athleteId, body: clubRecordBody(rec),
        payload: rec, occurred_at: new Date().toISOString(),
      });
      if (!error) posted += 1;
    }
    return posted;
  } catch (err) {
    console.warn('club record cards skipped:', err);
    return 0;
  }
}
