// ═════════════════════════════════════════════════════════════════════════════
// THE JOINING JOURNEY — both lanes, as the funnel screen draws them (2026-10-19).
//
// Ofer: "I want to press a step and see who is stuck there". So every person is
// placed at exactly ONE step — the first one they have not reached — with how long
// they have been waiting there, whether that is too long, and who has to act. The
// club lane is built from the member timeline (lib/onboarding/funnel.ts); the
// academy lane from the intake board (lib/academy/funnel.ts), whose own rules are
// kept as they are. Pure: the route reads, this decides, the tests pin it
// (src/__tests__/onboardingJourney.test.ts).
// ═════════════════════════════════════════════════════════════════════════════

import type { MemberFunnel } from './funnel';
import { median } from './funnel';
import { STAGES as ACADEMY_STAGES, PARKED_STAGES, type FunnelCandidate } from '@/lib/academy/funnel';

export type ClubStage = 'requested' | 'approved' | 'link' | 'installed' | 'logged_in' | 'push' | 'watch' | 'active';
export const CLUB_STAGES: ClubStage[] = ['requested', 'approved', 'link', 'installed', 'logged_in', 'push', 'watch', 'active'];

/**
 * Hours at a step before it counts as stuck. The approval and the first open are
 * short on purpose — that is where people were lost (analysis 2026-10-10); the
 * steps the member does at their own pace get two days. `active` is "has not
 * opened the app for a week", stuck the moment they land there.
 */
export const CLUB_STUCK_AFTER_H: Record<ClubStage, number> = {
  requested: 0, approved: 24, link: 24, installed: 48, logged_in: 24, push: 48, watch: 48, active: 0,
};

/** Who has to move for this person to move on. */
export type Owner = 'staff' | 'member' | 'manager' | 'coach' | 'trainee';

/** Something the club already sent this person: an email or a push. */
export interface SentItem { kind: 'email' | 'push'; key: string; at: string; ok: boolean }

export interface JourneyPerson {
  key: string;
  lane: 'club' | 'academy';
  name: string;
  athleteId: string | null;
  /** The signup request (club) or candidate (academy) behind them. */
  requestId: string | null;
  source: string | null;
  startedAt: string;
  /** The step they are at; null once every step is done. */
  at: string | null;
  owner: Owner | null;
  waitingSince: string;
  waitingHours: number;
  stuck: boolean;
  /** Steps reached, by key → ISO (academy: the day recorded). */
  reached: Record<string, string | null>;
  sent: SentItem[];
  /** Club, Strava sign-in: the address the approval will go to, or null when there is none. */
  notifyEmail?: string | null;
  strava?: boolean;
}

export interface LaneStage { key: string; reached: number; at: number; stuck: number; medianHours: number | null }
export interface Lane { stages: LaneStage[]; people: JourneyPerson[] }

const H = 3600_000;
const hoursSince = (iso: string, now: Date) => Math.max(0, Math.round(((now.getTime() - new Date(iso).getTime()) / H) * 10) / 10);
const earliest = (...xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x).sort()[0] ?? null;

export interface ClubInput {
  member: MemberFunnel;
  requestId: string | null;
  requestStatus: string | null;
  /** The real address a Strava sign-in left, when the row's own is synthetic. */
  notifyEmail?: string | null;
  strava?: boolean;
  sent?: SentItem[];
}

export function placeClubMember(c: ClubInput, now: Date = new Date()): JourneyPerson {
  const m = c.member;
  const ev = (step: string) => m.timeline.find((e) => e.step === step)?.at ?? null;
  const viaStrava = m.source === 'strava-login';
  const lastSeenRecent = !!m.lastSeenAt && now.getTime() - new Date(m.lastSeenAt).getTime() <= 7 * 24 * H;
  const reached: Record<ClubStage, string | null> = {
    requested: m.reached.requested ?? m.requestedAt,
    approved: m.reached.approved,
    // A Strava sign-in has no link to open: the waiting screen lets them in by itself.
    link: viaStrava ? m.reached.approved : earliest(ev('join_open'), ev('join_saved'), ev('welcome_open'), m.reached.opened),
    installed: earliest(ev('phone_app_opened')),
    logged_in: m.reached.opened,
    push: m.reached.push,
    watch: m.reached.watch,
    active: lastSeenRecent ? m.lastSeenAt : null,
  };
  // A member who was never asked to wait (approved at once, or added by staff) has no request row.
  if (!reached.approved && c.requestStatus === null && reached.logged_in) reached.approved = reached.requested;

  const at = CLUB_STAGES.find((s) => !reached[s]) ?? null;
  const before = at ? CLUB_STAGES.slice(0, CLUB_STAGES.indexOf(at)) : CLUB_STAGES;
  const startedAt = reached.requested ?? m.requestedAt ?? now.toISOString();
  const waitingSince = at === 'active'
    ? (m.lastSeenAt ?? startedAt)
    : before.map((s) => reached[s]).filter((x): x is string => !!x).sort().pop() ?? startedAt;
  const waitingHours = hoursSince(waitingSince, now);
  // A request somebody already turned down is not a person waiting at the door.
  const rejected = at === 'approved' && c.requestStatus !== null && c.requestStatus !== 'pending';
  return {
    key: m.athleteId ?? `req:${c.requestId ?? m.name}`,
    lane: 'club',
    name: m.name,
    athleteId: m.athleteId,
    requestId: c.requestId,
    source: m.source,
    startedAt,
    at: rejected ? null : at,
    owner: at === null || rejected ? null : at === 'approved' ? 'staff' : 'member',
    waitingSince,
    waitingHours,
    stuck: !rejected && at !== null && waitingHours >= CLUB_STUCK_AFTER_H[at],
    reached,
    sent: [...(c.sent ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    ...(c.strava ? { strava: true, notifyEmail: c.notifyEmail ?? null } : {}),
  };
}

/** The academy steps the screen draws: the board's, without the two parked ones. */
export const ACADEMY_LANE_STAGES = ACADEMY_STAGES.filter((s) => !PARKED_STAGES.has(s.key)).map((s) => s.key);

export function placeAcademyCandidate(c: FunnelCandidate, createdAt: string, dones: Record<string, string>, athleteId: string | null, sent: SentItem[] = [], now: Date = new Date()): JourneyPerson {
  const at = c.status === 'live' ? c.waitingFor : null;
  const reached = Object.fromEntries(ACADEMY_LANE_STAGES.map((k) => [k, dones[k] ?? null])) as Record<string, string | null>;
  return {
    key: `cand:${c.id}`,
    lane: 'academy',
    name: c.name,
    athleteId,
    requestId: c.id,
    source: c.source,
    startedAt: createdAt,
    at,
    owner: at ? (c.owner ?? null) : null,
    waitingSince: c.waitingSince,
    waitingHours: hoursSince(c.waitingSince, now),
    stuck: c.stuck,
    reached,
    sent: [...sent].sort((a, b) => b.at.localeCompare(a.at)),
  };
}

/**
 * Counts per step, as a real funnel: `reached` is how many got THROUGH to this step
 * — every step before it done — so it never grows down the lane (a member who
 * logged in from a browser without installing is still standing at "installed").
 * `at` is who stands at it now; `medianHours` is how long the step itself takes:
 * from reaching the previous step to reaching this one, over those who did both.
 */
export function laneStages(keys: string[], people: JourneyPerson[]): LaneStage[] {
  // Index of the first step not reached; past the end once every step is done.
  const pos = (p: JourneyPerson) => (p.at === null ? keys.length : Math.max(0, keys.indexOf(p.at)));
  return keys.map((key, i) => {
    const through = people.filter((p) => pos(p) > i);
    const prevKey = i > 0 ? keys[i - 1] : null;
    const gaps = prevKey
      ? through.map((p) => {
        const from = p.reached[prevKey];
        const to = p.reached[key];
        if (!from || !to) return null;
        return Math.max(0, Math.round(((new Date(to).getTime() - new Date(from).getTime()) / H) * 10) / 10);
      })
      : [];
    return {
      key,
      reached: through.length,
      at: people.filter((p) => p.at === key).length,
      stuck: people.filter((p) => p.at === key && p.stuck).length,
      medianHours: prevKey ? median(gaps) : null,
    };
  });
}

/** Who is waiting, longest wait first; the stuck ones before the merely waiting. */
export function byUrgency(a: JourneyPerson, b: JourneyPerson): number {
  return Number(b.stuck) - Number(a.stuck) || b.waitingHours - a.waitingHours || a.name.localeCompare(b.name);
}

/** The club's own admin mailbox: an account, not a person joining. */
const CLUB_ADMIN_EMAIL = 'madregot.club@gmail.com';

/**
 * Accounts that are not people joining: the two seeded test accounts, our own
 * `@madregot.local` addresses (bar the synthetic Strava ones, which ARE people),
 * `+test` sign-ups made to try the flow, and the club's admin mailbox. Without this
 * the funnel counted "Test Coach" and the super user's own trial runs as joiners.
 */
export function isTestJoiner(emails: Array<string | null | undefined>, athleteId: string | null | undefined, testIds: ReadonlySet<string>): boolean {
  if (athleteId && testIds.has(athleteId)) return true;
  return emails.some((raw) => {
    const e = (raw || '').toLowerCase().trim();
    if (!e) return false;
    if (e === CLUB_ADMIN_EMAIL) return true;
    if (/\+test\d*@/.test(e)) return true;
    return e.endsWith('@madregot.local') && !e.endsWith('@strava.madregot.local');
  });
}
