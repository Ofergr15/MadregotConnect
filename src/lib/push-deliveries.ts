import type { createServerClient } from '@/lib/supabase/server';

type Db = ReturnType<typeof createServerClient>;

// ═════════════════════════════════════════════════════════════════════════════
// Did the push SHOW (mockups/push-health.html, Ofer 10-23: "we cannot allow it to not
// arrive and fall on the way"). The send path writes one row per push per device
// (push.ts recordDeliveries, migration 171); the phone stamps shown_at when it
// displayed it (/api/push/receipt). A push the service took and the phone did not
// confirm within CONFIRM_MS is "not shown". Pure helpers over those rows + the reads.
// ═════════════════════════════════════════════════════════════════════════════

export const CONFIRM_MS = 10 * 60_000;
/** Pushes about the health check itself are never judged by it (no alert about an alert). */
export const SELF_KIND = 'push_health';
/** Staff pushes where one that did not show is worth telling the owner at once. */
export const IMPORTANT_KINDS = ['quality_session', 'session_folder', 'session_photos', 'signup_request', 'feedback_alert'];

export interface DeliveryRow {
  id: string; nid: string; athlete_id: string | null; subscription_id: string | null;
  kind: string | null; title: string | null; sent_at: string; accepted: boolean; error: string | null; shown_at: string | null;
}
export type DeliveryState = 'shown' | 'waiting' | 'not_shown' | 'refused' | 'no_device' | 'muted';

export function stateOf(r: Pick<DeliveryRow, 'accepted' | 'error' | 'shown_at' | 'sent_at'>, now = Date.now()): DeliveryState {
  if (r.shown_at) return 'shown';
  if (r.error === 'no-device') return 'no_device';
  if (r.error === 'muted' || r.error === 'maintenance') return 'muted';
  if (!r.accepted) return 'refused';
  return now - Date.parse(r.sent_at) < CONFIRM_MS ? 'waiting' : 'not_shown';
}

export interface Tally { sent: number; accepted: number; shown: number; notShown: number; waiting: number; noDevice: number; muted: number }
export function tally(rows: DeliveryRow[], now = Date.now()): Tally {
  const t: Tally = { sent: 0, accepted: 0, shown: 0, notShown: 0, waiting: 0, noDevice: 0, muted: 0 };
  for (const r of rows) {
    const s = stateOf(r, now);
    if (s === 'no_device') { t.noDevice++; continue; }
    if (s === 'muted') { t.muted++; continue; }
    t.sent++;
    if (r.accepted) t.accepted++;
    if (s === 'shown') t.shown++; else if (s === 'not_shown') t.notShown++; else if (s === 'waiting') t.waiting++;
  }
  return t;
}

/** The share shown, of what could be judged (sent, past the window). Null with nothing to judge. */
export function shownRate(t: Tally): number | null {
  const judged = t.shown + t.notShown + (t.sent - t.accepted);
  return judged ? Math.round((t.shown / judged) * 100) : null;
}

export async function readDeliveries(db: Db, sinceIso: string): Promise<DeliveryRow[] | null> {
  const out: DeliveryRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await db.from('push_deliveries')
      .select('id, nid, athlete_id, subscription_id, kind, title, sent_at, accepted, error, shown_at')
      .gte('sent_at', sinceIso).order('sent_at', { ascending: false }).range(from, from + 999);
    if (error) return out.length ? out : null; // 171 not pasted: null
    out.push(...((data || []) as DeliveryRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** One push (all its devices), newest first. */
export interface PushGroup { nid: string; title: string; kind: string | null; sentAt: string; tally: Tally; people: number }
export function groupByPush(rows: DeliveryRow[], now = Date.now()): PushGroup[] {
  const by = new Map<string, DeliveryRow[]>();
  for (const r of rows) by.set(r.nid, [...(by.get(r.nid) ?? []), r]);
  return [...by.entries()].map(([nid, rs]) => ({
    nid, title: rs[0].title ?? '', kind: rs[0].kind, sentAt: rs.reduce((a, r) => (r.sent_at < a ? r.sent_at : a), rs[0].sent_at),
    tally: tally(rs, now), people: new Set(rs.map((r) => r.athlete_id)).size,
  })).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

/** People whose every push the service took in the window went unshown — at least `min` of them. */
export function silentPeople(rows: DeliveryRow[], min = 3, now = Date.now()): Array<{ athleteId: string; unshown: number }> {
  const by = new Map<string, { shown: number; unshown: number }>();
  for (const r of rows) {
    if (!r.athlete_id || r.kind === SELF_KIND) continue;
    const s = stateOf(r, now);
    if (s !== 'shown' && s !== 'not_shown') continue;
    const e = by.get(r.athlete_id) ?? { shown: 0, unshown: 0 };
    if (s === 'shown') e.shown++; else e.unshown++;
    by.set(r.athlete_id, e);
  }
  return [...by.entries()].filter(([, e]) => e.shown === 0 && e.unshown >= min).map(([athleteId, e]) => ({ athleteId, unshown: e.unshown }));
}
