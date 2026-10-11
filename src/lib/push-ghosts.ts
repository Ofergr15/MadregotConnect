// ── Ghost endpoints a working sibling exposes ────────────────────────────────────
//
// Every push goes to all of an athlete's endpoints at once, so when one of them
// confirms a display (/api/push/receipt writes `last_success_at`) and another has
// confirmed nothing in the SIBLING_SILENT_DAYS before that, the silent one is not
// reaching anything — Apple keeps answering 201 for it forever.
//
// This used to be checked only when a device registered (/api/push/subscribe), and
// only against that device's own last display. A device that registers before it
// has displayed anything — the usual case, a fresh install — never triggers it, so
// the ghost it replaced stayed until the 30-day sweep: feedback #98 (detector
// push_orphan), and the same athlete again on Oct 7 → Oct 11. The send path now
// applies the same rule, anchored on the athlete's freshest confirmed display.

export const SIBLING_SILENT_DAYS = 3;

export interface SubHealth {
  id: string;
  athlete_id: string;
  created_at: string;
  last_success_at: string | null;
}

/** Ids of endpoints a sibling proves dead. Nothing for an athlete none of whose devices ever confirmed. */
export function siblingGhosts(rows: SubHealth[]): string[] {
  const byAthlete = new Map<string, SubHealth[]>();
  for (const r of rows) byAthlete.set(r.athlete_id, [...(byAthlete.get(r.athlete_id) ?? []), r]);
  const out: string[] = [];
  for (const subs of byAthlete.values()) {
    const seen = Math.max(...subs.map((s) => (s.last_success_at ? Date.parse(s.last_success_at) : NaN)).filter(Number.isFinite));
    if (!Number.isFinite(seen)) continue;
    const quiet = seen - SIBLING_SILENT_DAYS * 86_400_000;
    for (const s of subs) {
      const created = Date.parse(s.created_at);
      const last = s.last_success_at ? Date.parse(s.last_success_at) : NaN;
      // Old enough to have been sent what the live sibling showed, and showed none of it.
      if (created < quiet && !(last >= quiet)) out.push(s.id);
    }
  }
  return out;
}
