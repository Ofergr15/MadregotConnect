import { createServerClient } from '@/lib/supabase/server';
import { clearMaintenanceCache } from '@/lib/maintenance';
import { entryHandles } from '@/lib/admin/entry-queue';

/**
 * Let one person through the maintenance window, server-side.
 *
 * WHY THIS IS NOT JUST THE ALLOWLIST EDITOR: approving a signup while a window is
 * open used to do nothing the person could feel. They went from "not approved" to
 * "approved and still blocked" — the same closed door on their phone either way —
 * and the admin had no reason to suspect it, because the approve button lives on
 * one screen and the allowlist on another. The club runs windows for days at a
 * time (19 of 28 members are behind one right now, deliberately), so this is the
 * normal case, not an edge one. Approval now releases in the same request.
 *
 * Reads uncached and writes the union: never a replacement, so it cannot drop
 * whoever else is exempt — including the admin doing the tapping.
 *
 * Writes the athlete ID plus a real address when the row has one. Never the
 * synthetic `strava_<id>@…local`: an entry that can never match the person it was
 * meant to let in is exactly how maintenance mode locked out 100% of the club on
 * 2026-09-07.
 */
export async function releaseFromMaintenance(athlete: {
  id: string;
  email?: string | null;
}): Promise<{ on: boolean; released: boolean }> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['maintenance_mode', 'maintenance_allow']);
  const map = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const on = map['maintenance_mode'] === 'on';
  // Nothing to release from. Deliberately does NOT pre-authorise anybody for the
  // next window: an allowlist edited while the club is open is a list the admin is
  // curating for later, and quietly adding names to it would be a surprise.
  if (!on) return { on: false, released: false };

  const allow = (map['maintenance_allow'] || '')
    .split(',')
    .map((e: string) => e.toLowerCase().trim())
    .filter(Boolean);

  const handles = entryHandles(athlete);
  const missing = handles.filter((h) => !allow.includes(h));
  if (missing.length === 0) return { on: true, released: false };

  const { error } = await supabase
    .from('app_settings')
    .upsert(
      [{ key: 'maintenance_allow', value: [...allow, ...missing].join(','), updated_at: new Date().toISOString() }],
      { onConflict: 'key' },
    );
  if (error) throw error;
  // The API gate caches for 15s. Drop it so the person can get in on the tap
  // rather than up to a TTL later — this instance at least; others expire.
  clearMaintenanceCache();
  return { on: true, released: true };
}
