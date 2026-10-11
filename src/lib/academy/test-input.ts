// What POST /api/academy/tests accepts, checked on the server before the upsert.
//
// Pure. The forms already guard every field, but the self-entry card (academy-existing-trainees,
// phone 4) opens this route to every trainee, and a client guard is a suggestion: an impossible
// date or an HR outside migration 105's 80-230 used to reach the database and come back as a
// 500, and a future day, an unknown protocol or a 70 m "30 minutes" were stored with a 200.
//
// The implausible pace (tests.ts, PLAUSIBLE_PACE_SEC) stays what its own header says it is for
// staff — a warning, never a block — and is refused from a trainee: their number waits for a
// coach anyway, and one off by a factor of a thousand is a typo, not a test to approve.

import { PROTOCOL_SHAPE, paceLooksImplausible, thresholdPaceSec } from './tests';
import { ENTRY_PROTOCOLS } from './test-entry';

export interface TestInput {
  date: string;
  protocol: string;
  durationSec: number;
  distanceM: number;
  /** Null when not given. */
  avgHr: number | null;
}

export type InputField = 'date' | 'protocol' | 'durationSec' | 'distanceM' | 'avgHr' | 'pace';

export type InputCheck =
  | { ok: true; implausible: boolean }
  | { ok: false; field: InputField; error: string };

/** `YYYY-MM-DD` that is a day on the calendar (no 2026-13-40, no 31.02). */
export function isCalendarDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The body's avg HR: null when blank, NaN when it is there but not a number. */
export function readAvgHr(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  return Number(raw);
}

/**
 * One test as the route would store it. `today` is the Israel calendar day; `staff` widens the
 * protocols to every one the registry knows (PROTOCOL_SHAPE) and turns the pace into a warning.
 */
export function checkTestInput(input: TestInput, today: string, { staff }: { staff: boolean }): InputCheck {
  if (!isCalendarDate(input.date)) return { ok: false, field: 'date', error: 'date must be a real day, YYYY-MM-DD' };
  if (input.date > today) return { ok: false, field: 'date', error: 'date cannot be in the future' };
  const protocols: readonly string[] = staff ? Object.keys(PROTOCOL_SHAPE) : ENTRY_PROTOCOLS;
  if (!protocols.includes(input.protocol)) return { ok: false, field: 'protocol', error: `protocol must be one of ${protocols.join(', ')}` };
  if (!(Number.isFinite(input.durationSec) && input.durationSec > 0)) return { ok: false, field: 'durationSec', error: 'durationSec must be positive' };
  if (!(Number.isFinite(input.distanceM) && input.distanceM > 0)) return { ok: false, field: 'distanceM', error: 'distanceM must be positive' };
  if (input.avgHr !== null && !(Number.isFinite(input.avgHr) && input.avgHr >= 80 && input.avgHr <= 230)) {
    return { ok: false, field: 'avgHr', error: 'avgHr must be between 80 and 230' };
  }
  const implausible = paceLooksImplausible(thresholdPaceSec(input));
  if (implausible && !staff) return { ok: false, field: 'pace', error: 'That pace is not one a runner runs; check the distance and the time' };
  return { ok: true, implausible };
}

/** How many past tests one save may carry ("also save the older ones": at most MAX_CANDIDATES − 1). */
export const MAX_PAST = 5;
