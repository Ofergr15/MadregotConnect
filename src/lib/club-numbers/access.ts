import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;

/**
 * Who sees "מדרגות במספרים": the admin (or the super user), and the members the admin made
 * "מנהלי מדרגות" — a list in app_settings, not a role, so it opens this screen and its tab
 * and nothing else a staff role would (Ofer 2026-10-20).
 */
export const MANAGERS_KEY = 'club_managers';

export const isClubAdmin = (c: { isSuperUser: boolean; role?: string | null; roles?: string[] }) =>
  c.isSuperUser || (c.roles ?? [c.role]).includes('admin');

let managers: { at: number; ids: string[] } | null = null;
export async function clubManagers(supabase: Db): Promise<string[]> {
  if (managers && Date.now() - managers.at < 60_000) return managers.ids;
  const { data } = await supabase.from('app_settings').select('value').eq('key', MANAGERS_KEY).maybeSingle();
  let ids: string[] = [];
  try { const v = JSON.parse((data as { value?: string } | null)?.value || '[]'); ids = Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []; } catch { ids = []; }
  managers = { at: Date.now(), ids };
  return ids;
}
export async function setClubManagers(supabase: Db, ids: string[]): Promise<void> {
  const clean = [...new Set(ids)].slice(0, 100);
  const { error } = await supabase.from('app_settings').upsert({ key: MANAGERS_KEY, value: JSON.stringify(clean), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  managers = { at: Date.now(), ids: clean };
}
export async function mayViewNumbers(supabase: Db, c: { isSuperUser: boolean; role?: string | null; roles?: string[]; athleteId: string | null }): Promise<boolean> {
  if (isClubAdmin(c)) return true;
  return !!c.athleteId && (await clubManagers(supabase)).includes(c.athleteId);
}

// ── the numbers, kept ready ─────────────────────────────────────────────────────────
// Working the numbers out reads the club's whole year of runs (~3 s). The screen must open
// at once, so the last result is kept in app_settings and served as it is; when it is more
// than a few minutes old the request answers with it anyway and recomputes after replying
// (and the cron tick keeps it warm). Each server instance also holds it in memory.
export const SNAPSHOT_KEY = 'club_numbers_snapshot';
export const FRESH_MS = 5 * 60_000;
let mem: { at: number; body: unknown } | null = null;

export async function readSnapshot(supabase: Db): Promise<{ at: number; body: unknown } | null> {
  if (mem) return mem;
  const { data } = await supabase.from('app_settings').select('value').eq('key', SNAPSHOT_KEY).maybeSingle();
  try {
    const v = JSON.parse((data as { value?: string } | null)?.value || 'null');
    if (v && typeof v.at === 'number' && v.body) { mem = v; return v; }
  } catch { /* none yet */ }
  return null;
}
export async function writeSnapshot(supabase: Db, body: unknown): Promise<void> {
  mem = { at: Date.now(), body };
  await supabase.from('app_settings').upsert({ key: SNAPSHOT_KEY, value: JSON.stringify(mem), updated_at: new Date().toISOString() }, { onConflict: 'key' });
}
export const dropNumbers = () => { mem = null; };
