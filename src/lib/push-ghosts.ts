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

// ── One notification per phone ──────────────────────────────────────────────────
//
// iOS gives every home-screen install its own push subscription — the app added twice,
// or the club app beside the admin app (a second host) signed in to the same account —
// and each install shows its own copy of every push. Ofer, 2026-10-16: "I get several
// notifications for every action"; his account had two LIVE endpoints, both iPhone iOS
// 18.7, both confirming the same push at 13:16, and pushes reaching 2–4 endpoints.
//
// Same athlete + same user agent + more than one live endpoint = one phone. Only the
// one that confirmed most recently is sent to. If even that one has shown nothing for
// ONE_PER_PHONE_FRESH_DAYS, all of them are sent to again, so a dead pick can never
// silence the phone — whichever install is alive confirms and becomes the pick.

export const ONE_PER_PHONE_FRESH_DAYS = 3;

export interface SubDevice extends SubHealth {
  user_agent: string | null;
}

/** Ids not to send to: the other installs on a phone whose freshest install is known alive. */
export function duplicateInstalls(rows: SubDevice[], now: number = Date.now()): string[] {
  const groups = new Map<string, SubDevice[]>();
  for (const r of rows) {
    if (!r.user_agent) continue;
    const key = `${r.athlete_id}|${r.user_agent}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const fresh = now - ONE_PER_PHONE_FRESH_DAYS * 86_400_000;
  const skip: string[] = [];
  for (const subs of groups.values()) {
    if (subs.length < 2) continue;
    const ranked = subs
      .filter((s) => s.last_success_at)
      .sort((a, b) => Date.parse(b.last_success_at!) - Date.parse(a.last_success_at!));
    const keep = ranked[0];
    if (!keep || Date.parse(keep.last_success_at!) < fresh) continue;
    for (const s of subs) if (s.id !== keep.id) skip.push(s.id);
  }
  return skip;
}
