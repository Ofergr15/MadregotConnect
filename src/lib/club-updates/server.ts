import { invalidateShared, sharedCache, SHARED_TAGS } from '@/lib/cache/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { heldRoles } from '@/lib/auth/roles';
import { uniqueMentionedAthleteIds } from '@/lib/feed/mentions';
import { CLUB_ACCOUNT_ROLE } from '@/lib/notifications/prefs';
import { DEFAULT_CONFIG, REACTIONS, plainText, readConfigValue, type ClubUpdatesConfig } from './model';

/**
 * "עדכונים מהמועדון" — the server side: the switch and the writers (app_settings), the
 * stream (migration 154), and the push that goes a few seconds after a breaking update or
 * a tag, unless "ביטול" took it back first.
 */

type Db = SupabaseClient;
export const CONFIG_KEY = 'club_updates';

export async function readConfig(db: Db): Promise<ClubUpdatesConfig> {
  const { data } = await db.from('app_settings').select('value').eq('key', CONFIG_KEY).maybeSingle();
  return data ? readConfigValue((data as { value?: string }).value) : { ...DEFAULT_CONFIG };
}

export async function writeConfig(db: Db, cfg: ClubUpdatesConfig): Promise<boolean> {
  const { error } = await db.from('app_settings')
    .upsert({ key: CONFIG_KEY, value: JSON.stringify(cfg), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return !error;
}

/** The 42P01 / PGRST205 of a database that has not had migration 154 pasted yet. */
export const isMissingTable = (e: { code?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST200');

export interface UpdateRow {
  id: string;
  author_athlete_id: string;
  topic_id: string | null;
  body: string;
  image_url: string | null;
  breaking: boolean;
  pinned: boolean;
  notify_at: string | null;
  notified_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface ClubUpdate {
  id: string;
  author: { id: string; name: string; avatarUrl: string | null; role: string };
  body: string;
  imageUrl: string | null;
  breaking: boolean;
  pinned: boolean;
  topicId: string | null;
  createdAt: string;
  editedAt: string | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
}

const COLUMNS = 'id, author_athlete_id, topic_id, body, image_url, breaking, pinned, notify_at, notified_at, edited_at, deleted_at, created_at';

/** "מנהל" / "מאמן" / "צוות" — what the stream prints under the writer's name. */
export function roleLabel(role: string | null, extra: unknown): string {
  const r = heldRoles(role, extra);
  if (r.includes('admin')) return 'מנהל';
  if (r.includes('coach') || r.includes('academy_coach')) return 'מאמן';
  return 'צוות';
}

export async function loadRow(db: Db, id: string): Promise<UpdateRow | null> {
  const { data } = await db.from('club_updates').select(COLUMNS).eq('id', id).maybeSingle();
  return (data as UpdateRow | null) ?? null;
}

/**
 * The raw rows of the stream — the same for every member, so they come from the
 * shared cache (lib/cache/shared.ts). Per-viewer shaping (`project`: likes, `me`,
 * the undo window) still runs per request on top. Throws on a read error so an
 * error is never cached; a missing table answers `missing` (cached too — it only
 * changes when a migration is pasted, and a write invalidates).
 */
async function readUpdateRows(db: Db, limit: number, since: string | null, topicIds: string[] | null): Promise<{ rows: UpdateRow[]; missing: boolean }> {
  let q = db.from('club_updates').select(COLUMNS).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit);
  if (since) q = q.gte('created_at', since);
  if (topicIds) q = q.in('topic_id', topicIds);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return { rows: [], missing: true };
    throw error;
  }
  const rows = (data || []) as UpdateRow[];
  // A pinned update stays at the top of the stream, and in the feed, however old it is.
  {
    let pq = db.from('club_updates').select(COLUMNS).is('deleted_at', null).eq('pinned', true);
    if (topicIds) pq = pq.in('topic_id', topicIds);
    const { data: pins } = await pq.order('created_at', { ascending: false }).limit(3);
    for (const p of (pins || []) as UpdateRow[]) if (!rows.some((r) => r.id === p.id)) rows.push(p);
  }
  return { rows, missing: false };
}

/** The feed's "since" window, floored to the minute so it can be a cache key (≤ 60 s wider). */
export function sinceKey(since: string | null | undefined): string | null {
  if (!since) return null;
  const ms = Date.parse(since);
  return Number.isFinite(ms) ? new Date(Math.floor(ms / 60_000) * 60_000).toISOString() : since;
}

/** Newest first, pinned ones included wherever they fall (the client lifts them). */
export async function listUpdates(db: Db, viewerId: string | null, opts: { limit: number; since?: string | null; topicIds?: string[] }): Promise<{ updates: ClubUpdate[]; missing: boolean }> {
  // A filter that resolved to no topic matches nothing — never fall back to the whole stream.
  if (opts.topicIds && opts.topicIds.length === 0) return { updates: [], missing: false };
  // Wrapped per call so the client isn't a key argument; unstable_cache keys on the
  // key parts + the plain arguments, so every call shares the same entries.
  const shared = sharedCache(
    (limit: number, since: string | null, topicIds: string[] | null) => readUpdateRows(db, limit, since, topicIds),
    ['club-updates:rows:v1'], { tag: SHARED_TAGS.clubUpdates, revalidate: 300 },
  );
  const { rows, missing } = await shared(opts.limit, sinceKey(opts.since), opts.topicIds ? [...opts.topicIds].sort() : null);
  if (missing) return { updates: [], missing: true };
  return { updates: await project(db, rows, viewerId), missing: false };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClubUpdateTopic {
  id: string;
  eventId: string | null;
  name: string;
  pinnedText: string | null;
  opensAt: string;
  closesAt: string | null;
}

interface TopicRow { id: string; name: string; event_id: string | null; pinned_text: string | null; opens_at: string; closes_at: string | null }
const TOPIC_COLUMNS = 'id, name, event_id, pinned_text, opens_at, closes_at';

/** Topics (migration 154) by event and/or id, earliest-opening first. `missing` when the table isn't there. */
export async function listTopics(db: Db, by: { eventId?: string; ids?: string[] }): Promise<{ topics: ClubUpdateTopic[]; missing: boolean }> {
  let q = db.from('club_update_topics').select(TOPIC_COLUMNS);
  if (by.eventId) q = q.eq('event_id', by.eventId);
  if (by.ids) q = q.in('id', by.ids);
  const { data, error } = await q.order('opens_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { topics: [], missing: true };
    throw error;
  }
  return {
    topics: ((data || []) as TopicRow[]).map((t) => ({
      id: t.id, eventId: t.event_id, name: t.name, pinnedText: t.pinned_text, opensAt: t.opens_at, closesAt: t.closes_at,
    })),
    missing: false,
  };
}

export async function project(db: Db, rows: UpdateRow[], viewerId: string | null): Promise<ClubUpdate[]> {
  if (rows.length === 0) return [];
  const authorIds = [...new Set(rows.map((r) => r.author_athlete_id))];
  const ids = rows.map((r) => r.id);
  const [{ data: people }, { data: reacts }] = await Promise.all([
    db.from('athletes').select('id, name, avatar_url, role, extra_roles').in('id', authorIds),
    db.from('club_update_reactions').select('update_id, athlete_id, emoji').in('update_id', ids),
  ]);
  const byId = new Map(((people || []) as Array<{ id: string; name: string | null; avatar_url: string | null; role: string | null; extra_roles?: unknown }>).map((p) => [p.id, p]));
  const counts = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const r of (reacts || []) as Array<{ update_id: string; athlete_id: string; emoji: string }>) {
    const m = counts.get(r.update_id) ?? new Map();
    const e = m.get(r.emoji) ?? { count: 0, mine: false };
    e.count += 1;
    if (r.athlete_id === viewerId) e.mine = true;
    m.set(r.emoji, e);
    counts.set(r.update_id, m);
  }
  return rows.map((r) => {
    const p = byId.get(r.author_athlete_id);
    const m = counts.get(r.id);
    return {
      id: r.id,
      author: { id: r.author_athlete_id, name: (p?.name || '').trim() || 'מדרגות', avatarUrl: p?.avatar_url ?? null, role: roleLabel(p?.role ?? null, p?.extra_roles) },
      body: r.body,
      imageUrl: r.image_url,
      breaking: r.breaking,
      pinned: r.pinned,
      topicId: r.topic_id,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      // In the fixed order, so the pills never reshuffle as counts change.
      reactions: m ? REACTIONS.filter((e) => m.has(e)).map((e) => ({ emoji: e, ...m.get(e)! })) : [],
    };
  });
}

/** Everyone the club pushes to: active members, not the club's own account. */
async function memberIds(db: Db): Promise<string[]> {
  const { data } = await db.from('athletes').select('id, role').eq('coach_id', COACH_ID).eq('status', 'active');
  return ((data || []) as Array<{ id: string; role: string | null }>).filter((a) => a.role !== CLUB_ACCOUNT_ROLE).map((a) => a.id);
}

const preview = (body: string) => {
  const t = plainText(body).replace(/\s+/g, ' ').trim();
  return t.length > 140 ? `${t.slice(0, 139)}…` : t;
};

/**
 * The push for one update, once its undo window is over: breaking → every member; a tag →
 * the tagged runner. Claims `notified_at` first, so a second call sends nothing, and reads
 * the row again, so an update deleted (ביטול) or edited in the window is honoured.
 */
export async function sendUpdatePush(db: Db, id: string): Promise<number> {
  const now = new Date().toISOString();
  const { data: claimed } = await db.from('club_updates').update({ notified_at: now })
    .eq('id', id).is('notified_at', null).is('deleted_at', null).select(COLUMNS).maybeSingle();
  invalidateShared(SHARED_TAGS.clubUpdates);
  const row = claimed as UpdateRow | null;
  if (!row) return 0;
  const { notifyAthlete } = await import('@/lib/push');
  const { data: author } = await db.from('athletes').select('name').eq('id', row.author_athlete_id).maybeSingle();
  const who = ((author as { name?: string } | null)?.name || '').trim().split(/\s+/)[0] || 'המועדון';
  const url = `/updates?u=${row.id}`;
  const text = preview(row.body);
  const tagged = uniqueMentionedAthleteIds(row.body, row.author_athlete_id);
  const all = row.breaking ? (await memberIds(db)).filter((x) => x !== row.author_athlete_id) : [];
  const targets = [...new Set([...tagged, ...all])];
  let sent = 0;
  await Promise.all(targets.map(async (athleteId) => {
    const isTagged = tagged.includes(athleteId);
    try {
      const r = await notifyAthlete({
        athleteId,
        kind: isTagged ? 'club_update_mention' : 'club_update',
        actorAthleteId: row.author_athlete_id,
        url,
        tag: `club-update-${row.id}`,
        category: isTagged ? 'teammates' : 'news',
        copy: (locale) => locale === 'en'
          ? { title: isTagged ? `${who} wrote about you in the club updates` : '🟠 Breaking · Madregot', body: text }
          : { title: isTagged ? `${who} כתב/ה עליך בעדכונים מהמועדון` : '🟠 מבזק · מדרגות', body: text },
      });
      if (r.delivered) sent += r.delivered;
    } catch (err) {
      console.error('[club-updates] push failed for', athleteId, err);
    }
  }));
  return sent;
}

/** Whether an update needs a push at all (the rest are quiet). */
export const wantsPush = (body: string, breaking: boolean, authorId: string) =>
  breaking || uniqueMentionedAthleteIds(body, authorId).length > 0;
