// Admin approval before the pushes that go out ahead of a team workout — the
// pure half (no DB), shared by the cron, the API and the approval screen.
//
// Ofer, 2026-10-10: "before we send a notification ahead of a quality workout,
// pop it to the admin; they approve and then it happens". One decision covers a
// whole team day: the day-before reminder, the pace-group survey, and the two
// evening nudges (cron/tick stages 1–4). Nothing approved by the time a push is
// due means it is not sent. An approval that comes late still sends what is
// left of that day's window (`stageDue`). Stored in app_settings, so no migration.

export const APPROVAL_KEY = 'notif_approvals';

/** Which team days need an approval: only quality ones, every one, or none. */
export type ApprovalMode = 'quality' | 'team' | 'off';
export const APPROVAL_MODES: ApprovalMode[] = ['quality', 'team', 'off'];

export interface ApprovalDecision {
  status: 'approved' | 'skipped';
  /** Who decided: the approver's name (or email when there is none). */
  by: string;
  at: string;
}

export interface ApprovalStore {
  mode: ApprovalMode;
  /** Team-day date (YYYY-MM-DD, Israel) → the decision for that day's pushes. */
  days: Record<string, ApprovalDecision>;
}

export type GateState = 'not_needed' | 'pending' | 'approved' | 'skipped';

/** One push the approval screen shows, Hebrew copy as the runners will read it. */
export interface ApprovalPush { key: string; when: string; audience: string; title: string; body: string }
/** One team day on the approval screen. */
export interface ApprovalDay {
  date: string;
  dayOfWeek: number;
  workoutName: string | null;
  quality: boolean;
  state: GateState;
  decidedBy: string | null;
  decidedAt: string | null;
  pushes: ApprovalPush[];
}


const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseApprovals(raw: string | null | undefined): ApprovalStore {
  const out: ApprovalStore = { mode: 'quality', days: {} };
  try {
    const v = JSON.parse(raw || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    if (APPROVAL_MODES.includes(v.mode)) out.mode = v.mode;
    for (const [date, d] of Object.entries((v.days ?? {}) as Record<string, any>)) {
      if (!DATE.test(date) || !d || (d.status !== 'approved' && d.status !== 'skipped')) continue;
      out.days[date] = { status: d.status, by: String(d.by ?? ''), at: String(d.at ?? '') };
    }
  } catch { /* default */ }
  return out;
}

/** Does this team day's pushes need an approval, and is there one. */
export function gateState(store: ApprovalStore, teamDate: string, isQualityDay: boolean): GateState {
  if (store.mode === 'off') return 'not_needed';
  if (store.mode === 'quality' && !isQualityDay) return 'not_needed';
  return store.days[teamDate]?.status ?? 'pending';
}

/**
 * Is a stage due on this tick. Without a gate (or before the decision) a stage
 * fires in its own hour only, exactly as before. Once approved, a stage whose
 * hour already went by while waiting still fires, up to `windowEnd` (exclusive)
 * — so approving at 10:00 sends the 08:00 reminder at 10:00, and approving at
 * 23:00 sends nothing that night.
 */
export function stageDue(gate: GateState, hour: number, stageHour: number, windowEnd: number): boolean {
  if (gate === 'pending' || gate === 'skipped') return false;
  if (gate === 'approved') return hour >= stageHour && hour < Math.max(windowEnd, stageHour + 1);
  return hour === stageHour;
}

/**
 * When to ask: from the hour before the first push of the day until the last
 * push's hour. A deploy or a missed tick inside that window still asks.
 */
export function shouldAsk(gate: GateState, hour: number, firstHour: number, lastHour: number): boolean {
  return gate === 'pending' && hour >= firstHour - 1 && hour <= lastHour;
}

/** The decision for one day, written into the store; older than 30 days is dropped. */
export function withDecision(store: ApprovalStore, teamDate: string, decision: ApprovalDecision | null, today: string): ApprovalStore {
  const floor = addDays(today, -30);
  const days: Record<string, ApprovalDecision> = {};
  for (const [d, v] of Object.entries(store.days)) if (d >= floor && d !== teamDate) days[d] = v;
  if (decision) days[teamDate] = decision;
  return { ...store, days };
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dowOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
