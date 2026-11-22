// The "new club record" feed card (design/records-prototype shot 11).
//
// A feed_items row of the EXISTING type 'achievement' (no CHECK change, no migration),
// told apart by `payload.kind === 'club_record'`. One card per broken record, posted
// when the records snapshot recomputes and its holder changed. The push stays the
// record-breaker's own (new-record-alert.ts) — the club gets the card, not a buzz.
//
// Privacy: the card only ever names a holder who is ON the time tables (not opted
// out, not hiding pace) — the snapshot it diffs is filtered the same way the tables
// are — and the previous holder is named only if they are on them too. If the card's
// own hiddenFields carry `pace`, `maskClubRecordPayload` drops both times, so the
// card reads "new club record · 5K" with no time (same key as every pace mask).

import { isOnTimeTable, type RecordFacts } from './board';

export const CLUB_RECORD_KIND = 'club_record';

export interface ClubRecordPayload {
  kind: typeof CLUB_RECORD_KIND;
  bucketKey: string;
  athleteId: string;
  name: string;
  seconds: number | null;
  activityId: string | null;
  date: string | null;
  previous: { name: string; seconds: number | null; date: string | null } | null;
}

export interface EntryLike { athleteId: string; name: string; seconds: number; activityId: string | null; date: string | null }
export interface BucketLike { key: string; entries: EntryLike[] }

const fastestVisible = (b: BucketLike | undefined, facts: Map<string, RecordFacts>) =>
  [...(b?.entries ?? [])].filter((e) => isOnTimeTable(facts.get(e.athleteId) ?? {})).sort((x, y) => x.seconds - y.seconds)[0] ?? null;

/**
 * Records that fell between two snapshots: the visible #1 got strictly faster. A
 * first snapshot (no `before`) announces nothing — that is a table appearing, not a
 * record breaking.
 */
export function newClubRecords(
  before: BucketLike[] | null,
  after: BucketLike[],
  facts: Map<string, RecordFacts>,
): ClubRecordPayload[] {
  if (!before) return [];
  const out: ClubRecordPayload[] = [];
  for (const b of after) {
    const now = fastestVisible(b, facts);
    const was = fastestVisible(before.find((x) => x.key === b.key), facts);
    if (!now || !was || now.seconds >= was.seconds) continue;
    out.push({
      kind: CLUB_RECORD_KIND, bucketKey: b.key, athleteId: now.athleteId, name: now.name, seconds: now.seconds,
      activityId: now.activityId, date: now.date,
      previous: { name: was.name, seconds: was.seconds, date: was.date },
    });
  }
  return out;
}

export function isClubRecordPayload(p: unknown): p is ClubRecordPayload {
  return !!p && typeof p === 'object' && (p as { kind?: unknown }).kind === CLUB_RECORD_KIND;
}

/** Hidden pace on the card → no times (the record itself is still news). */
export function maskClubRecordPayload<T>(payload: T): T {
  if (!isClubRecordPayload(payload)) return payload;
  const hidden = (payload as unknown as { hiddenFields?: unknown }).hiddenFields;
  if (!Array.isArray(hidden) || !hidden.includes('pace')) return payload;
  return {
    ...payload,
    seconds: null,
    previous: payload.previous ? { ...payload.previous, seconds: null } : null,
  } as T;
}

const HE: Record<string, string> = { '5k': '5 ק״מ', '10k': '10 ק״מ', hm: 'חצי מרתון', fm: 'מרתון' };

/** Body for any client that doesn't know the kind (the PWA's fallback card). No time in it. */
export function clubRecordBody(p: Pick<ClubRecordPayload, 'bucketKey' | 'name'>): string {
  return `👑 שיא מועדון חדש · ${HE[p.bucketKey] ?? p.bucketKey} — ${p.name}`;
}
