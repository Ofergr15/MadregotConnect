/**
 * The coaches board (אנשים → מאמנים): per coach, how many trainees, how much of the
 * plan they ran, who is not running, and how many of the coach's places are taken.
 *
 * Pure — the component draws `buildCoachCards`. The coach list comes from
 * `GET /api/academy/coaches` (who holds the role), and every number about trainees
 * from the members payload the shell already holds, so the board and the members
 * list cannot disagree about who is whose.
 */

import { memberCoachIds, memberHasCoach, type AcademyMember, type AttentionReason } from './members';

/** The places a coach holds when the academy settings do not say. */
export const DEFAULT_COACH_CAPACITY = 8;

/**
 * Behind or not running: the orange places on the bar, and the "K לא רץ" count.
 * `low_adherence` is behind; `inactive` and `no_runs` are not running at all.
 */
const BEHIND: ReadonlySet<AttentionReason> = new Set(['inactive', 'no_runs', 'low_adherence']);
const NOT_RUNNING: ReadonlySet<AttentionReason> = new Set(['inactive', 'no_runs']);

export interface CoachRef { id: string; name: string; avatarUrl: string | null; trainees: number }

export interface CoachCard {
  id: string;
  name: string;
  avatarUrl: string | null;
  trainees: AcademyMember[];
  /** Trainees behind or not running. */
  behind: number;
  /** Trainees not running at all. */
  notRunning: number;
  /** Completed ÷ planned across the caseload; null when nobody had a plan. */
  completionRate: number | null;
  capacity: number;
  /** Never negative — an over-capacity coach has 0 free, not −2. */
  free: number;
  /** Bar cells, in drawing order: taken-and-fine, then behind, then free. */
  slots: Array<'filled' | 'behind' | 'free'>;
}

/** A capacity from settings, or the default for anything that is not a positive whole number. */
export function coachCapacityOf(settings: unknown): number {
  const raw = (settings as { coachCapacity?: unknown } | null | undefined)?.coachCapacity;
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw <= 50 ? raw : DEFAULT_COACH_CAPACITY;
}

export function buildCoachCards(coaches: CoachRef[], members: AcademyMember[], capacity: number): CoachCard[] {
  return coaches.map((c) => {
    const trainees = members
      // A shared trainee is on each of their coaches' cards, and takes a place on each.
      .filter((m) => memberHasCoach(m, c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const behind = trainees.filter((m) => m.attention.some((r) => BEHIND.has(r))).length;
    const notRunning = trainees.filter((m) => m.attention.some((r) => NOT_RUNNING.has(r))).length;
    const planned = trainees.reduce((s, m) => s + m.plannedCount, 0);
    const done = trainees.reduce((s, m) => s + m.completedCount, 0);
    const taken = trainees.length;
    // The bar is as long as the capacity, or as the caseload when it runs over — an
    // over-full coach shows every trainee, not a bar that silently stops at 8.
    const cells = Math.max(capacity, taken);
    const slots: CoachCard['slots'] = Array.from({ length: cells }, (_, i) =>
      i < taken - behind ? 'filled' : i < taken ? 'behind' : 'free');
    return {
      id: c.id,
      name: c.name,
      avatarUrl: c.avatarUrl,
      trainees,
      behind,
      notRunning,
      completionRate: planned > 0 ? Math.min(1, done / planned) : null,
      capacity,
      free: Math.max(0, capacity - taken),
      slots,
    };
  });
}

/** Approved trainees nobody coaches — who "לשבץ אליו" would place. */
export function unpairedTrainees(members: AcademyMember[]): AcademyMember[] {
  return members
    .filter((m) => memberCoachIds(m).length === 0 && m.approved && m.status !== 'removed')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "6 מתאמנים · 69% בתוכנית · 1 לא רץ" as parts, so the view can LTR-isolate each number
 * (a bare "69%" inside Hebrew renders as "%69"). `value` null = a phrase with no number.
 */
export function coachSummaryParts(
  card: Pick<CoachCard, 'trainees' | 'completionRate' | 'notRunning'>,
): Array<{ value: string | null; label: string }> {
  const n = card.trainees.length;
  if (n === 0) return [{ value: null, label: 'עוד אין מתאמנים' }];
  const parts: Array<{ value: string | null; label: string }> = [
    n === 1 ? { value: null, label: 'מתאמן אחד' } : { value: String(n), label: 'מתאמנים' },
  ];
  if (card.completionRate !== null) parts.push({ value: `${Math.round(card.completionRate * 100)}%`, label: 'בתוכנית' });
  if (card.notRunning > 0) parts.push({ value: String(card.notRunning), label: card.notRunning === 1 ? 'לא רץ' : 'לא רצים' });
  return parts;
}

/**
 * The one coach "לשבץ אליו" is offered on: the freest (most free places, then fewest
 * trainees, then name). One offer, not one per coach with a gap — the mockup's
 * "ההצעה: Avi Peretz, הפנוי ביותר" — so the board makes a suggestion instead of
 * asking the manager to choose between identical buttons. Null when nobody is
 * unpaired or nobody has room.
 */
export function suggestedCoachId(cards: Pick<CoachCard, 'id' | 'name' | 'free' | 'trainees'>[], unpaired: number): string | null {
  if (unpaired <= 0) return null;
  const open = cards.filter((c) => c.free > 0);
  if (!open.length) return null;
  open.sort((a, b) => b.free - a.free || a.trainees.length - b.trainees.length || a.name.localeCompare(b.name));
  return open[0].id;
}

/**
 * "להוסיף מתאמן" on a coach card: the trainees that coach could be given — every
 * approved academy trainee they do not already hold. The unpaired first (they are
 * who needs a coach), then by name. Adding keeps a trainee's other coaches.
 */
export function traineesToAdd(coachId: string, members: AcademyMember[]): AcademyMember[] {
  return members
    .filter((m) => m.approved && m.status !== 'removed' && m.athleteId !== coachId && !memberCoachIds(m).includes(coachId))
    .sort((a, b) => Number(memberCoachIds(a).length > 0) - Number(memberCoachIds(b).length > 0) || a.name.localeCompare(b.name));
}

/**
 * The bulk body behind both "add to this coach" buttons on the board ("לשבץ אליו"
 * for the unpaired, "להוסיף מתאמן" for anyone): 'addCoach', never 'coach', so a
 * trainee who already has coaches keeps them.
 */
export function addToCoachBody(coachId: string, athleteIds: string[], notify = true) {
  return { athleteIds, action: 'addCoach' as const, coachIds: [coachId], notify };
}
