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

// The numbers move once a sync lands, not every second, and the read is the club's whole
// year of runs: kept for a few minutes per server instance.
let cache: { at: number; body: unknown } | null = null;
const TTL_MS = 5 * 60_000;
export const cachedNumbers = () => (cache && Date.now() - cache.at < TTL_MS ? cache.body : null);
export const keepNumbers = (body: unknown) => { cache = { at: Date.now(), body }; };
export const dropNumbers = () => { cache = null; };
