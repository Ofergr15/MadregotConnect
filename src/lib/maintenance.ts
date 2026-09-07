import { createServerClient } from '@/lib/supabase/server';

/**
 * Maintenance mode, decided on the server.
 *
 * It used to be an overlay and nothing more: <MaintenanceGate> asked
 * `/api/maintenance?email=…` — an address the CALLER supplies — and hid itself if
 * the answer said allowed. So every way past it was a one-liner in the console:
 * pass an allowlisted address, write `coach_email` into localStorage (the
 * super-user check read it from there), set any "view as" scenario, or just fail
 * the request, since the gate fails open. Meanwhile every API kept serving, so
 * behind the overlay the app was fully working. "The club is closed" was a picture
 * of a closed door, not a closed door.
 *
 * Now the same window that draws the overlay refuses the data: resolveVerifiedCaller
 * — which every member, staff and self-or-staff route funnels through — returns 503
 * for anyone not on the allowlist. Bypassing the overlay gets you an empty shell.
 *
 * Deliberately NOT gated by this: requireSession itself. /api/auth/me and the
 * maintenance endpoint resolve through it, and gating it would leave the shell
 * unable to work out who you are or to turn maintenance back off — locking the
 * club out of its own switch.
 *
 * The allowlist governs everyone, staff included; that is the existing product
 * decision (see PUT /api/maintenance, which auto-adds whoever turns it on so they
 * cannot lock themselves out).
 */

export interface MaintenanceState {
  on: boolean;
  /** Lower-cased addresses that may use the app while it is on. */
  allow: string[];
}

const OFF: MaintenanceState = { on: false, allow: [] };

/**
 * Cached for a few seconds because this now runs on the hottest path in the app —
 * once per authenticated request — and the answer changes about twice a month. The
 * window is what a toggle takes to reach everyone, so it is kept short.
 */
const TTL_MS = 15_000;
let cache: { state: MaintenanceState; expires: number } | null = null;

/** Drop the cached answer — for the route that just changed it, and for tests. */
export function clearMaintenanceCache(): void {
  cache = null;
}

export async function readMaintenance(): Promise<MaintenanceState> {
  if (cache && cache.expires > Date.now()) return cache.state;
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['maintenance_mode', 'maintenance_allow']);
    // Fails OPEN, and on purpose: a read that did not answer is not evidence that
    // the club is closed, and answering "closed" would take a working app down
    // over a blip. The cost is that a genuine outage does not enforce the window.
    if (error) return OFF;
    const map = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const state: MaintenanceState = {
      on: map['maintenance_mode'] === 'on',
      allow: (map['maintenance_allow'] || '')
        .split(',')
        .map((e: string) => e.toLowerCase().trim())
        .filter(Boolean),
    };
    cache = { state, expires: Date.now() + TTL_MS };
    return state;
  } catch {
    return OFF;
  }
}

/**
 * Is this person shut out right now? Pure, so the rule is testable without a
 * database — and it is one rule, used by both the API gate and the screen, rather
 * than two that can drift.
 */
export function maintenanceBlocks(email: string | null | undefined, state: MaintenanceState): boolean {
  if (!state.on) return false;
  const who = (email || '').toLowerCase().trim();
  // No resolvable identity while maintenance is on is blocked, not exempt: the
  // allowlist cannot recognise somebody it knows nothing about.
  if (!who) return true;
  return !state.allow.includes(who);
}
