import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { newRecordCopy } from '@/lib/notifications/copy';
import { isNewMember } from '@/lib/badges/award-engine';
import { formatTime } from '@/lib/academy/benchmark';
import { teammateHref } from '@/lib/athletes/profile-link';
import { computeDistanceBests, filterQualifyingRuns, PR_BUCKETS, type RunActivityRow } from './pr-buckets';
import { attachLapsForPrs } from './attach-laps';
import { readPrOverrides } from './overrides-store';
import { readPrExclusions, type PrExclusions } from './exclusions-store';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { areTwins, withoutTwins, type TwinCandidate } from '@/lib/academy/twins';
import { isFeatureEnabled } from '@/lib/features/server';

/**
 * "YOU JUST BROKE A RECORD" — the push and the in-app sheet that send the athlete to
 * the record's timeline (Ofer, 2026-10-17: "when there's a new record it should pop up
 * and alert you to look at the history of breaking records — so it's accessible and
 * actually used").
 *
 * Called after a Garmin/Strava/device sync, beside the badge check. NOT from the
 * history backfill, the daily cron or race matching — those bring old runs in, and a
 * "new record" about a run from 2022 is the notification flood this app has had
 * before. The rules, every one of them deliberate:
 *
 *  - A real break: there WAS a record and this run beat it. The first record at a
 *    distance already gets a badge ("first 5K"); two notifications would be noise.
 *  - A fresh run: run in the last RECENT_DAYS. A sync that imports an old run that
 *    happens to beat the record (a newly connected watch) sends nothing.
 *  - Not a new member's: everything is a record on day one (isNewMember, the same
 *    rule the badges use).
 *  - What the profile shows: a time the athlete stated by hand that is still faster
 *    keeps the record, so nothing moved and nothing is said. Runs they took out of
 *    their records (migration 146) are out here too.
 *  - Once per run: the notification row is the record of having said it. Two syncs
 *    of one run send one push.
 *  - One push per run, however many distances it broke.
 *  - One run recorded twice (Garmin + its Strava copy) is one run. Uncollapsed, the
 *    twin at the same time was "the record without this run", so a real PR read as a
 *    tie and nobody was told; and a twin synced later under another id was told
 *    again. Twins are collapsed before the comparison, and "said already" checks
 *    every copy's id (task 159).
 *  - A feed card for the club (kind 'personal_record'), behind `personal_record_feed`
 *    (default off), once per run and its twins. The card carries the distances and
 *    the run, never a time: the record screen it links to applies the runner's
 *    hide-pace setting live, a time frozen in a feed payload could not.
 */
export const RECENT_DAYS = 3;
export const RECORD_KIND = 'record';

type Supabase = ReturnType<typeof createServerClient>;

export interface NewRecord {
  activityId: string;
  bucket: string;
  seconds: number;
  /** How much faster than the record it replaced. */
  gainSec: number;
}

/** The pure half: which records the latest runs just broke. */
export function findNewRecords(
  runsIn: RunActivityRow[],
  opts: { excluded?: PrExclusions; now?: number; stated?: Map<string, number> } = {},
): NewRecord[] {
  const now = opts.now ?? Date.now();
  // Twins collapsed first (see the header) — only possible when every row carries an id.
  const runs = runsIn.every((r) => !!r.id)
    ? withoutTwins(runsIn as unknown as Array<RunActivityRow & TwinCandidate>) as RunActivityRow[]
    : runsIn;
  const bests = computeDistanceBests(runs, { excluded: opts.excluded });
  const out: NewRecord[] = [];
  for (const best of bests) {
    if (best.seconds == null || !best.activityId || !best.date) continue;
    if (now - Date.parse(best.date) > RECENT_DAYS * 86_400_000) continue;
    // A stated record still faster: the profile's record didn't move.
    const stated = opts.stated?.get(best.key);
    if (stated != null && stated <= best.seconds) continue;
    // The record without this run — none means this was the first one (a badge's job).
    const without: PrExclusions = new Map(opts.excluded);
    without.set(best.activityId, new Set([...(opts.excluded?.get(best.activityId) ?? []), best.key]));
    const before = computeDistanceBests(runs, { excluded: without }).find(b => b.key === best.key);
    if (before?.seconds == null || before.seconds <= best.seconds) continue;
    out.push({ activityId: best.activityId, bucket: best.key, seconds: best.seconds, gainSec: before.seconds - best.seconds });
  }
  return out;
}

/**
 * The record screen a new record opens (/dashboard/teammate/[id]/records/[bucket] —
 * a record belongs to a profile), carrying the run so the screen can celebrate it.
 */
export function newRecordUrl(athleteId: string, r: Pick<NewRecord, 'bucket' | 'activityId'>): string {
  return `${teammateHref(athleteId) ?? '/dashboard/profile'}/records/${encodeURIComponent(r.bucket)}?new=${r.activityId}`;
}

/** The ids of `activityId` and every twin of it in `acts` — "this run", under any of its ids. */
export function twinGroupIds(activityId: string, acts: Array<RunActivityRow & Partial<TwinCandidate>>): string[] {
  const self = acts.find((a) => a.id === activityId);
  if (!self) return [activityId];
  const out = [activityId];
  for (const a of acts) {
    if (!a.id || a.id === activityId) continue;
    if (areTwins(self as TwinCandidate, a as TwinCandidate)) out.push(a.id);
  }
  return out;
}

export const PERSONAL_RECORD_KIND = 'personal_record';

/** The feed card's payload. No time on purpose (see the header). */
export interface PersonalRecordPayload {
  kind: typeof PERSONAL_RECORD_KIND;
  athleteId: string;
  activityId: string;
  /** Shortest distance first, like the push. */
  buckets: string[];
}

export function personalRecordPayload(athleteId: string, activityId: string, records: Pick<NewRecord, 'bucket'>[]): PersonalRecordPayload {
  return { kind: PERSONAL_RECORD_KIND, athleteId, activityId, buckets: records.map((r) => r.bucket) };
}

/** Body for a client that doesn't know the kind. No time in it. */
export function personalRecordBody(buckets: string[]): string {
  const names = buckets.map((b) => HE[b] ?? b);
  return names.length === 1 ? `🏆 שיא אישי חדש ב־${names[0]}` : `🏆 ${names.length} שיאים אישיים חדשים: ${names.join(', ')}`;
}

const HE: Record<string, string> = { '5k': '5 ק״מ', '10k': '10 ק״מ', hm: 'חצי מרתון', fm: 'מרתון' };
const EN: Record<string, string> = { '5k': '5K', '10k': '10K', hm: 'half marathon', fm: 'marathon' };

export async function notifyNewRecords(athleteId: string): Promise<NewRecord[]> {
  const supabase: Supabase = createServerClient();
  if (await isNewMember(supabase, athleteId)) return [];

  const acts = await fetchAllRows<RunActivityRow & { source?: string | null }>((from, to) =>
    supabase
      .from('athlete_activities')
      .select('id, activity_name, activity_type, start_time, distance, duration, source')
      .eq('athlete_id', athleteId)
      .order('start_time', { ascending: false })
      .order('id')
      .range(from, to),
  );
  // Nothing recent, nothing to say — and no lap fetch for it.
  if (!acts.some(a => Date.now() - Date.parse(a.start_time) <= RECENT_DAYS * 86_400_000)) return [];

  const runs = await attachLapsForPrs(supabase, athleteId, filterQualifyingRuns(acts));
  const [excluded, overrides] = await Promise.all([readPrExclusions(supabase, athleteId), readPrOverrides(supabase, athleteId)]);
  const stated = new Map<string, number>();
  for (const o of overrides) if (!o.hidden && o.seconds != null) stated.set(o.bucketKey, o.seconds);
  // A hidden distance shows no record at all; a new one there is not news either.
  const hidden = new Set(overrides.filter(o => o.hidden).map(o => o.bucketKey));
  const fresh = findNewRecords(runs, { excluded, stated }).filter(r => !hidden.has(r.bucket));
  if (fresh.length === 0) return [];

  const byRun = new Map<string, NewRecord[]>();
  for (const r of fresh) byRun.set(r.activityId, [...(byRun.get(r.activityId) ?? []), r]);

  const sent: NewRecord[] = [];
  for (const [activityId, records] of byRun) {
    // Said already? The notification row is the memory (kind 'record', the run in the
    // url) — under this id or any twin's: the Strava copy synced first is the same run.
    const ids = twinGroupIds(activityId, acts as Array<RunActivityRow & Partial<TwinCandidate>>);
    const { data: prior } = await supabase
      .from('scheduled_notifications')
      .select('id')
      .eq('audience_id', athleteId)
      .eq('kind', RECORD_KIND)
      .or(ids.map((id) => `url.like.*new=${id}*`).join(','))
      .limit(1);
    if (prior && prior.length) continue;

    // Shortest distance first: the order the profile's tiles are in.
    records.sort((a, b) => PR_BUCKETS.findIndex(x => x.key === a.bucket) - PR_BUCKETS.findIndex(x => x.key === b.bucket));
    const lead = records[0];
    await notifyAthlete({
      athleteId,
      kind: RECORD_KIND,
      copy: (locale) => newRecordCopy(locale, {
        distancesHe: records.map(r => HE[r.bucket] ?? r.bucket),
        distancesEn: records.map(r => EN[r.bucket] ?? r.bucket),
        time: formatTime(lead.seconds),
        gainSec: lead.gainSec,
      }),
      url: newRecordUrl(athleteId, lead),
      tag: `record-${activityId}`,
      category: 'achievements',
    });
    await postPersonalRecordCard(supabase, athleteId, activityId, ids, records);
    sent.push(...records);
  }
  return sent;
}

/**
 * The club's feed card for a new PR — flag `personal_record_feed` (default off), once per
 * run and its twins (keyed on `payload.activityId`). Best effort: never throws, the push
 * already went.
 */
export async function postPersonalRecordCard(
  supabase: Supabase,
  athleteId: string,
  activityId: string,
  twinIds: string[],
  records: Pick<NewRecord, 'bucket'>[],
): Promise<boolean> {
  try {
    if (!(await isFeatureEnabled('personal_record_feed', athleteId, supabase as never))) return false;
    const { data: prior, error: priorError } = await supabase.from('feed_items').select('id')
      .eq('type', 'achievement').eq('payload->>kind', PERSONAL_RECORD_KIND)
      .in('payload->>activityId', twinIds).limit(1);
    // Could not tell whether it is there: a second card is worse than none.
    if (priorError || (prior && prior.length)) return false;
    const payload = personalRecordPayload(athleteId, activityId, records);
    const { error } = await supabase.from('feed_items').insert({
      type: 'achievement', author_athlete_id: athleteId, body: personalRecordBody(payload.buckets),
      payload, occurred_at: new Date().toISOString(),
    });
    return !error;
  } catch (err) {
    console.warn('personal record card skipped:', err);
    return false;
  }
}
