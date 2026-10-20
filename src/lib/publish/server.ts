import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { BUCKET_LABEL, clock, parseRecordUrl } from './model';
import { sessionDayLabel, toSessionPhotos } from '@/lib/quality-session/photos';
import { isMissingColumn } from './pin';

// The writes and reads behind "לפרסם" (lib/publish/model.ts for the rules).

type Db = ReturnType<typeof createServerClient>;

/** A post from the club (author null) on the feed. Returns its id. */
export async function publishClubPost(db: Db, p: {
  body: string;
  media?: Array<{ path: string; url: string; w: number | null; h: number | null }>;
  payload: Record<string, unknown>;
}): Promise<string | null> {
  const { data, error } = await db.from('feed_items').insert({
    type: 'announcement',
    author_athlete_id: null,
    body: p.body,
    ...(p.media?.length ? { media: p.media } : {}),
    payload: p.payload,
    occurred_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

export interface Suggestion {
  athleteId: string;
  name: string;
  reason: 'race' | 'record';
  /** "מרתון תל אביב ב־2:58:41" — what the cheer's text says. */
  detail: string;
  /** "שיא ב־10 ק״מ · אתמול" — the row's second line. */
  line: string;
  at: string;
}

/** Who deserves a cheer: personal records and races from the last three days. */
export async function cheerSuggestions(db: Db, now: Date = new Date()): Promise<Suggestion[]> {
  const since = new Date(now.getTime() - 3 * 86400000).toISOString();
  const [{ data: recs }, { data: races }] = await Promise.all([
    db.from('scheduled_notifications').select('audience_id, url, last_sent_at').eq('kind', 'record').gte('last_sent_at', since).order('last_sent_at', { ascending: false }).limit(30),
    db.from('race_matches').select('athlete_id, activity_id, event_id, is_race').eq('is_race', true).limit(200),
  ]);
  const recRows = ((recs || []) as Array<{ audience_id: string | null; url: string | null; last_sent_at: string }>)
    .map((r) => ({ ...parseRecordUrl(r.url), at: r.last_sent_at }))
    .filter((r): r is { athleteId: string; bucket: string; activityId: string | null; at: string } => !!(r as { athleteId?: string }).athleteId);
  const raceRows = (races || []) as Array<{ athlete_id: string; activity_id: string; event_id: string | null }>;
  const activityIds = [...new Set([...recRows.map((r) => r.activityId).filter(Boolean) as string[], ...raceRows.map((r) => r.activity_id)])];
  const acts = new Map<string, { start_time: string; distance: number; duration: number }>();
  if (activityIds.length) {
    const { data } = await db.from('athlete_activities').select('id, start_time, distance, duration').in('id', activityIds).gte('start_time', since);
    for (const a of (data || []) as Array<{ id: string; start_time: string; distance: number; duration: number }>) acts.set(a.id, a);
  }
  const eventIds = [...new Set(raceRows.map((r) => r.event_id).filter(Boolean) as string[])];
  const events = new Map<string, string>();
  if (eventIds.length) {
    const { data } = await db.from('events').select('id, name').in('id', eventIds);
    for (const e of (data || []) as Array<{ id: string; name: string }>) events.set(e.id, e.name);
  }
  const out: Suggestion[] = [];
  for (const r of recRows) {
    const a = r.activityId ? acts.get(r.activityId) : undefined;
    const label = BUCKET_LABEL[r.bucket] || r.bucket;
    out.push({ athleteId: r.athleteId, name: '', reason: 'record', detail: `${label}${a ? ` ב־${clock(a.duration)}` : ''}`, line: `שיא ב־${label}`, at: r.at });
  }
  for (const r of raceRows) {
    const a = acts.get(r.activity_id);
    if (!a) continue; // older than three days
    const ev = (r.event_id && events.get(r.event_id)) || 'המרוץ';
    out.push({ athleteId: r.athlete_id, name: '', reason: 'race', detail: `${ev} ב־${clock(a.duration)}`, line: `${ev} · ${(a.distance / 1000).toFixed(1)} ק״מ`, at: a.start_time });
  }
  const ids = [...new Set(out.map((s) => s.athleteId))];
  if (!ids.length) return [];
  const { data: people } = await db.from('athletes').select('id, name').in('id', ids).eq('coach_id', COACH_ID).eq('status', 'active');
  const names = new Map(((people || []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name || '']));
  const seen = new Set<string>();
  return out
    .filter((s) => names.has(s.athleteId))
    .map((s) => ({ ...s, name: names.get(s.athleteId)! }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((s) => { const k = `${s.athleteId}:${s.reason}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8);
}

export interface RecentItem {
  id: string; kind: 'message' | 'cheer' | 'survey' | 'photos'; text: string; at: string; likes: number; comments: number;
  answers: number | null; emoji: string;
  /** Phones the post's push reached, when it was recorded (a message's or a survey's row); null = not known. */
  delivered: number | null;
  /** A session-photos post: its first photo and how many are on the card. */
  thumb?: string | null; photos?: number;
}

/**
 * The club's last posts, for the hub (Content v4: each kind's "פורסם" list, each post
 * with its own numbers). `limit` 6 is the old hub's "פורסם לאחרונה".
 */
export async function recentPublished(db: Db, limit = 6): Promise<RecentItem[]> {
  const { data } = await db.from('feed_items').select('id, body, payload, media, occurred_at, like_count, comment_count')
    .eq('type', 'announcement').is('author_athlete_id', null).is('deleted_at', null)
    .order('occurred_at', { ascending: false }).limit(limit);
  const rows = (data || []) as Array<{ id: string; body: string | null; payload: Record<string, unknown> | null; media: Array<{ url?: string }> | null; occurred_at: string; like_count: number | null; comment_count: number | null }>;
  const surveyIds = rows.map((r) => r.payload?.surveyId).filter((v): v is string => typeof v === 'string');
  const notifIds = rows.map((r) => r.payload?.notificationId).filter((v): v is string => typeof v === 'string');
  const answers = new Map<string, number>();
  const delivered = new Map<string, number>();
  await Promise.all([
    // People, not rows: a survey with more than one answer has a row per answer (161).
    surveyIds.length ? db.from('survey_responses').select('survey_id, athlete_id').in('survey_id', surveyIds).then(({ data: resp }) => {
      const who = new Map<string, Set<string>>();
      for (const r of (resp || []) as Array<{ survey_id: string; athlete_id: string }>) {
        const s = who.get(r.survey_id) ?? new Set<string>(); s.add(r.athlete_id); who.set(r.survey_id, s);
      }
      for (const [k, v] of who) answers.set(k, v.size);
    }) : null,
    // A survey's push is its own scheduled_notifications row (api/admin/surveys); a message's
    // post carries the id of the row that sent it (lib/feed/announce.ts).
    surveyIds.length ? db.from('scheduled_notifications').select('survey_id, sent_count').in('survey_id', surveyIds).then(({ data: n }) => {
      for (const r of (n || []) as Array<{ survey_id: string; sent_count: number | null }>) delivered.set(`s:${r.survey_id}`, (delivered.get(`s:${r.survey_id}`) ?? 0) + (r.sent_count ?? 0));
    }) : null,
    notifIds.length ? db.from('scheduled_notifications').select('id, sent_count').in('id', notifIds).then(({ data: n }) => {
      for (const r of (n || []) as Array<{ id: string; sent_count: number | null }>) delivered.set(`n:${r.id}`, r.sent_count ?? 0);
    }) : null,
  ]);
  return rows.map((r) => {
    const sid = typeof r.payload?.surveyId === 'string' ? r.payload.surveyId : null;
    const nid = typeof r.payload?.notificationId === 'string' ? r.payload.notificationId : null;
    const photos = r.payload?.kind === 'session_photos';
    const kind: RecentItem['kind'] = photos ? 'photos' : sid ? 'survey' : r.payload?.cheerFor || r.payload?.birthdayOf ? 'cheer' : 'message';
    // By what it is, not one 🏅 for all: a birthday and a marathon read alike (10-19).
    const REASON: Record<string, string> = { race: '🏁', record: '🏅', milestone: '🏅', birthday: '🎂', comeback: '💪' };
    const emoji = photos ? '📸' : sid ? '📊' : r.payload?.birthdayOf ? '🎂' : r.payload?.cheerFor ? REASON[String(r.payload.reason)] ?? '🎉' : '📣';
    // A photos card names its session: "עליות · שלישי 20.10", or the day alone.
    const sp = photos ? toSessionPhotos(r.payload) : null;
    const name = sp ? [sp.workoutName, sessionDayLabel(sp.date)].filter(Boolean).join(' · ') : null;
    const d = sid ? delivered.get(`s:${sid}`) : nid ? delivered.get(`n:${nid}`) : undefined;
    return {
      id: r.id, kind, text: (name || (r.body || '').replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi, '$1').split('\n')[0]).slice(0, 70),
      at: r.occurred_at, likes: r.like_count ?? 0, comments: r.comment_count ?? 0, answers: sid ? answers.get(sid) ?? 0 : null, emoji,
      delivered: d ?? null,
      ...(photos ? { thumb: r.media?.[0]?.url ?? null, photos: r.media?.length ?? 0 } : {}),
    };
  });
}

/**
 * Is migration 161 in this database? One cheap probe of the column; a missing one is
 * isMissingColumn (lib/publish/pin.ts). Pin and multi-answer requests are refused
 * with MIGRATION_161 until it is, so a post is never half made.
 */
export async function hasMigration161(db: Db): Promise<boolean> {
  const { error } = await db.from('feed_items').select('pinned_until').limit(1);
  if (!error) return true;
  if (isMissingColumn(error)) return false;
  throw error;
}

/** Pin a post until `until` (ISO). */
export async function pinPost(db: Db, id: string, until: string): Promise<void> {
  const { error } = await db.from('feed_items').update({ pinned_until: until }).eq('id', id);
  if (error) throw error;
}

/** The club post a just-sent message became (lib/feed/announce.ts folds packs into one): newest with that text. */
export async function postWithText(db: Db, text: string): Promise<string | null> {
  const { data } = await db.from('feed_items').select('id').eq('type', 'announcement').is('author_athlete_id', null)
    .eq('body', text).gte('occurred_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .order('occurred_at', { ascending: false }).limit(1);
  return ((data || []) as Array<{ id: string }>)[0]?.id ?? null;
}
