// ═════════════════════════════════════════════════════════════════════════════
// THE JOINING FUNNEL — one timeline per new member, from every source there is.
//
// Before migration 139 the only record of a join was a handful of timestamps
// scattered over signup_requests, athletes and push_subscriptions; since 139 the
// app also reports each step with its device (lib/onboarding/events.ts). This
// merges both into one ordered timeline per member, then derives what Ofer asked
// to see (2026-10-10): how they joined, on which device, how long each step took,
// and who is stuck where. Pure: the route does the reads, this does the thinking,
// so the rules are unit-tested (src/__tests__/onboardingFunnel.test.ts).
// ═════════════════════════════════════════════════════════════════════════════

export type FunnelStage = 'requested' | 'approved' | 'opened' | 'watch' | 'push' | 'tour' | 'setup';
export const FUNNEL_STAGES: FunnelStage[] = ['requested', 'approved', 'opened', 'watch', 'push', 'tour', 'setup'];

export interface TimelineEvent { step: string; at: string; device: string | null; source: 'event' | 'record' }

export interface MemberInput {
  athleteId: string | null;
  name: string;
  source: string | null;          // signup_requests.source
  requestedAt: string | null;     // signup_requests.created_at (or athletes.created_at)
  requestStatus: string | null;
  approvedAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  garminAt: string | null;
  hasGarmin: boolean;
  hasStrava: boolean;
  tourSeenAt: string | null;
  setupDoneAt: string | null;
  phoneOpenedAt: string | null;
  push: Array<{ at: string; device: string | null }>;
  events: TimelineEvent[];
}

export type StuckReason = 'awaiting_approval' | 'approved_not_opened' | 'no_watch' | 'no_push' | 'computer_only';

export interface MemberFunnel {
  athleteId: string | null;
  name: string;
  source: string | null;
  requestedAt: string | null;
  timeline: TimelineEvent[];
  reached: Record<FunnelStage, string | null>;
  /** Hours from request to each stage (null = not reached / unknown start). */
  hours: Record<FunnelStage, number | null>;
  devices: string[];
  stuck: Array<{ reason: StuckReason; sinceHours: number }>;
  lastSeenAt: string | null;
}

const H = 3600_000;
const hoursBetween = (a: string | null, b: string | null) => (a && b ? Math.round(((new Date(b).getTime() - new Date(a).getTime()) / H) * 10) / 10 : null);
const earliest = (...xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x).sort()[0] ?? null;

/** Steps that count as reaching a stage, from either source. */
const STAGE_STEPS: Record<FunnelStage, string[]> = {
  requested: ['register_submitted', 'strava_login', 'join_open'],
  approved: ['approved'],
  opened: ['first_open', 'code_verified', 'first_run_start', 'phone_app_opened'],
  watch: ['garmin_connected', 'strava_connected'],
  push: ['push_granted'],
  tour: ['tour_done', 'tour_skipped', 'latest_shown'],
  setup: ['setup_done'],
};

export function buildMember(m: MemberInput, now: Date = new Date()): MemberFunnel {
  const rec = (step: string, at: string | null, device: string | null = null): TimelineEvent[] => (at ? [{ step, at, device, source: 'record' }] : []);
  const all: TimelineEvent[] = [
    ...rec('register_submitted', m.requestedAt),
    ...rec('approved', m.approvedAt),
    ...rec('first_open', m.firstSeenAt),
    ...rec('garmin_connected', m.garminAt),
    ...rec('tour_done', m.tourSeenAt),
    ...rec('setup_done', m.setupDoneAt),
    ...rec('phone_app_opened', m.phoneOpenedAt),
    ...m.push.slice(0, 1).flatMap((p) => rec('push_granted', p.at, p.device)),
    ...m.events,
  ];
  // One entry per step: the earliest, but a reported event's device wins over a bare record.
  const byStep = new Map<string, TimelineEvent>();
  for (const e of all.sort((a, b) => a.at.localeCompare(b.at))) {
    const cur = byStep.get(e.step);
    if (!cur) byStep.set(e.step, e);
    else if (!cur.device && e.device) byStep.set(e.step, { ...cur, device: e.device });
  }
  const timeline = [...byStep.values()].sort((a, b) => a.at.localeCompare(b.at));

  const reached = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, earliest(...STAGE_STEPS[s].map((st) => byStep.get(st)?.at))])) as Record<FunnelStage, string | null>;
  // A watch connected at join (Strava login) has no timestamp of its own before 139: it counts, undated.
  if (!reached.watch && (m.hasGarmin || m.hasStrava) && reached.opened) reached.watch = reached.opened;
  const start = reached.requested ?? m.requestedAt;
  const hours = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, hoursBetween(start, reached[s])])) as Record<FunnelStage, number | null>;

  const age = (since: string | null) => (since ? (now.getTime() - new Date(since).getTime()) / H : 0);
  const stuck: MemberFunnel['stuck'] = [];
  if (!reached.approved && m.requestStatus === 'pending' && age(start) > 24) stuck.push({ reason: 'awaiting_approval', sinceHours: Math.round(age(start)) });
  if (reached.approved && !reached.opened && age(reached.approved) > 24) stuck.push({ reason: 'approved_not_opened', sinceHours: Math.round(age(reached.approved)) });
  if (reached.opened && !reached.watch && age(reached.opened) > 48) stuck.push({ reason: 'no_watch', sinceHours: Math.round(age(reached.opened)) });
  if (reached.opened && !reached.push && age(reached.opened) > 48) stuck.push({ reason: 'no_push', sinceHours: Math.round(age(reached.opened)) });
  const devices = [...new Set(timeline.map((e) => e.device).filter((d): d is string => !!d))];
  const phoneSeen = devices.some((d) => d !== 'computer') || !!m.phoneOpenedAt || m.push.length > 0;
  if (reached.opened && !phoneSeen && devices.includes('computer') && age(reached.opened) > 24) stuck.push({ reason: 'computer_only', sinceHours: Math.round(age(reached.opened)) });

  return { athleteId: m.athleteId, name: m.name, source: m.source, requestedAt: start, timeline, reached, hours, devices, stuck, lastSeenAt: m.lastSeenAt };
}

export function median(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => x != null && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
}

export interface FunnelSummary {
  members: number;
  stages: Array<{ stage: FunnelStage; count: number; medianHours: number | null }>;
  /** Approval → first open, the gap where people were lost (analysis 2026-10-10). */
  medianApproveToOpen: number | null;
  activated48h: number;
  stuck: number;
  devices: Record<string, number>;
}

export function summarise(members: MemberFunnel[]): FunnelSummary {
  const devices: Record<string, number> = {};
  for (const m of members) for (const d of m.devices) devices[d] = (devices[d] ?? 0) + 1;
  return {
    members: members.length,
    stages: FUNNEL_STAGES.map((stage) => ({
      stage,
      count: members.filter((m) => m.reached[stage]).length,
      medianHours: median(members.map((m) => m.hours[stage])),
    })),
    medianApproveToOpen: median(members.map((m) => hoursBetween(m.reached.approved, m.reached.opened))),
    activated48h: members.filter((m) => m.hours.opened != null && m.hours.opened <= 48 && m.reached.watch).length,
    stuck: members.filter((m) => m.stuck.length > 0).length,
    devices,
  };
}
