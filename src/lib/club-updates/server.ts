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

/** Newest first, pinned ones included wherever they fall (the client lifts them). */
export async function listUpdates(db: Db, viewerId: string | null, opts: { limit: number; since?: string | null }): Promise<{ updates: ClubUpdate[]; missing: boolean }> {
  let q = db.from('club_updates').select(COLUMNS).is('deleted_at', null).order('created_at', { ascending: false }).limit(opts.limit);
  if (opts.since) q = q.gte('created_at', opts.since);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return { updates: [], missing: true };
    throw error;
  }
  const rows = (data || []) as UpdateRow[];
  // A pinned update stays at the top of the stream, and in the feed, however old it is.
  {
    const { data: pins } = await db.from('club_updates').select(COLUMNS).is('deleted_at', null).eq('pinned', true).order('created_at', { ascending: false }).limit(3);
    for (const p of (pins || []) as UpdateRow[]) if (!rows.some((r) => r.id === p.id)) rows.push(p);
  }
  return { updates: await project(db, rows, viewerId), missing: false };
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
