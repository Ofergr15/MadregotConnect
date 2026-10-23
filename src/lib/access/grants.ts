import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;

// ═════════════════════════════════════════════════════════════════════════════
// Per-account access to Content (mockups/access-hub.html, Ofer 10-23: "who can
// publish what, and who is exposed to what — another layer"). Each part of Content
// has a level per person: 0 not seen, 1 sees (what was published, what waits),
// 2 publishes for approval (lib/access/drafts — an admin approves it, then it goes
// out), 3 publishes. The role sets the floor: staff publish everything, as before this
// existed; a grant only ever adds. Stored like the club managers list — one JSON
// value in app_settings, no migration — with every change in a log beside it.
// ═════════════════════════════════════════════════════════════════════════════

export const CONTENT_KINDS = ['share', 'photos', 'messages', 'surveys', 'cheers', 'circle'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export type Level = 0 | 1 | 2 | 3;
export type ContentLevels = Record<ContentKind, Level>;

export interface Grant { content?: Partial<Record<ContentKind, Level>> }
export type Grants = Record<string, Grant>;
export interface LogEntry { at: string; by: string | null; byName?: string | null; athleteId: string; name?: string | null; kind: ContentKind; from: Level; to: Level }

export const GRANTS_KEY = 'access_grants';
export const LOG_KEY = 'access_log';
const STAFF = ['admin', 'coach', 'academy_coach', 'academy_manager'];

export const NONE: ContentLevels = { share: 0, photos: 0, messages: 0, surveys: 0, cheers: 0, circle: 0 };
const ALL: ContentLevels = { share: 3, photos: 3, messages: 3, surveys: 3, cheers: 3, circle: 3 };

const asLevel = (v: unknown): Level => (v === 3 ? 3 : v === 2 ? 2 : v === 1 ? 1 : 0);
/** The parts a draft can stand for: what an admin can approve by replaying it. */
export const DRAFTABLE: ContentKind[] = ['messages', 'surveys', 'cheers', 'circle'];

/** What the role alone gives: staff publish every part (unchanged), anyone else nothing. */
export function roleLevels(c: { isSuperUser?: boolean; isStaff?: boolean; role?: string | null; roles?: string[] }): ContentLevels {
  const held = [c.role, ...(c.roles ?? [])].filter(Boolean) as string[];
  return c.isSuperUser || c.isStaff || held.some((r) => STAFF.includes(r)) ? { ...ALL } : { ...NONE };
}

/** The role's floor, raised by this person's grant. */
export function levelsFor(c: Parameters<typeof roleLevels>[0], grant: Grant | undefined): ContentLevels {
  const out = roleLevels(c);
  for (const k of CONTENT_KINDS) {
    const g = asLevel(grant?.content?.[k]);
    if (g > out[k]) out[k] = g;
  }
  return out;
}

export const seesAny = (l: ContentLevels) => CONTENT_KINDS.some((k) => l[k] >= 1);

let cache: { at: number; grants: Grants } | null = null;
export async function readGrants(supabase: Db): Promise<Grants> {
  if (cache && Date.now() - cache.at < 60_000) return cache.grants;
  const { data } = await supabase.from('app_settings').select('value').eq('key', GRANTS_KEY).maybeSingle();
  let grants: Grants = {};
  try {
    const v = JSON.parse((data as { value?: string } | null)?.value || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) grants = v as Grants;
  } catch { grants = {}; }
  cache = { at: Date.now(), grants };
  return grants;
}

/** The caller's levels: the role, raised by the grant (one cached read). */
export async function callerLevels(supabase: Db, c: Parameters<typeof roleLevels>[0] & { athleteId?: string | null }): Promise<ContentLevels> {
  const base = roleLevels(c);
  if (CONTENT_KINDS.every((k) => base[k] === 3) || !c.athleteId) return base;
  return levelsFor(c, (await readGrants(supabase))[c.athleteId]);
}

export async function readLog(supabase: Db): Promise<LogEntry[]> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', LOG_KEY).maybeSingle();
  try { const v = JSON.parse((data as { value?: string } | null)?.value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Set one person's level for one part, and write it to the log. */
export async function setContentLevel(supabase: Db, input: {
  athleteId: string; kind: ContentKind; level: Level; by: string | null; byName?: string | null; name?: string | null;
}): Promise<Grants> {
  cache = null;
  const grants = await readGrants(supabase);
  const prev = asLevel(grants[input.athleteId]?.content?.[input.kind]);
  const content = { ...(grants[input.athleteId]?.content ?? {}) };
  if (input.level === 0) delete content[input.kind]; else content[input.kind] = input.level;
  const next: Grants = { ...grants };
  if (Object.keys(content).length) next[input.athleteId] = { ...next[input.athleteId], content }; else delete next[input.athleteId];
  const now = new Date().toISOString();
  const { error } = await supabase.from('app_settings').upsert({ key: GRANTS_KEY, value: JSON.stringify(next), updated_at: now }, { onConflict: 'key' });
  if (error) throw error;
  cache = { at: Date.now(), grants: next };
  if (prev !== input.level) {
    const log = await readLog(supabase);
    const entry: LogEntry = { at: now, by: input.by, byName: input.byName ?? null, athleteId: input.athleteId, name: input.name ?? null, kind: input.kind, from: prev, to: input.level };
    await supabase.from('app_settings').upsert({ key: LOG_KEY, value: JSON.stringify([entry, ...log].slice(0, 300)), updated_at: now }, { onConflict: 'key' });
  }
  return next;
}
