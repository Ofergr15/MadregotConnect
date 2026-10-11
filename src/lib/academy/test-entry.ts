// A test typed in by hand (mockup academy-existing-trainees, phones 2 and 4): the one
// measured half, read the way a person types it, and the threshold it gives while they type.
//
// Pure. The form draws `entryPreview`; the save posts `entryRow`'s numbers to
// POST /api/academy/tests, which stores both halves as it always has.
//
// A 30-minute test fixes the clock and measures the distance; a 2000 m fixes the distance and
// measures the clock (PROTOCOL_SHAPE in tests.ts). So each protocol asks for ONE number:
//   30min  "7.12" (km) or "7120" (m) — anything above 100 is metres, nobody runs 100 km in 30 min;
//   2000m  "7:05" or "7:05.4" (m:ss), or a bare "425" (seconds).
//
// Only the 30-minute test gives a threshold (test-state.ts, DECIDED): a 2000 m effort runs well
// above it. The preview says so instead of printing a pace that would make every zone too fast.

import { PROTOCOL_SHAPE, paceLooksImplausible, thresholdPaceSec } from './tests';

export type EntryProtocol = '30min' | '2000m';

export const ENTRY_PROTOCOLS: readonly EntryProtocol[] = ['30min', '2000m'];

/** A distance as typed: km with a dot or a comma, or whole metres. Null for anything else. */
export function parseDistanceM(raw: string): number | null {
  const s = String(raw ?? '').trim().replace(/[^\d.,]/g, '').replace(',', '.');
  if (!s || !/^\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n > 100 ? n : n * 1000);
}

/** A time as typed: `m:ss`, `m:ss.s`, `h:mm:ss`, or bare seconds. Null for anything else. */
export function parseClockSec(raw: string): number | null {
  const s = String(raw ?? '').trim().replace(/[׳']/g, ':').replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : null;
  }
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  const [, h, mm, ss] = m;
  if (Number(ss) >= 60 || (h && Number(mm) >= 60)) return null;
  const total = Number(h || 0) * 3600 + Number(mm) * 60 + Number(ss);
  return total > 0 ? total : null;
}

/** An average HR as typed, or null when blank. `invalid` when typed but out of 80-230 (migration 105). */
export function parseAvgHr(raw: string): number | null | 'invalid' {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 80 || n > 230) return 'invalid';
  return n;
}

export interface EntryRow {
  protocol: EntryProtocol;
  durationSec: number;
  distanceM: number;
}

/** The stored row's two halves from the one typed value, or null while it is not a number yet. */
export function entryRow(protocol: EntryProtocol, measured: string): EntryRow | null {
  const shape = PROTOCOL_SHAPE[protocol];
  if (shape.fixed === 'duration') {
    const distanceM = parseDistanceM(measured);
    return distanceM ? { protocol, durationSec: shape.value, distanceM } : null;
  }
  const durationSec = parseClockSec(measured);
  return durationSec ? { protocol, durationSec, distanceM: shape.value } : null;
}

export interface EntryPreview {
  row: EntryRow | null;
  /** sec/km of the effort itself (what a 2000 m was run at). */
  effortPaceSec: number | null;
  /** The threshold it gives: the 30-minute test only. */
  thresholdSec: number | null;
  /** The pace is outside anything a human runs — usually km typed as metres, or minutes as seconds. */
  implausible: boolean;
}

export function entryPreview(protocol: EntryProtocol, measured: string): EntryPreview {
  const row = entryRow(protocol, measured);
  const pace = row ? thresholdPaceSec(row) : null;
  const effortPaceSec = pace === null ? null : Math.round(pace);
  return {
    row,
    effortPaceSec,
    thresholdSec: protocol === '30min' ? effortPaceSec : null,
    implausible: paceLooksImplausible(pace),
  };
}

/** `2026-09-14` → `14.09.2026`, the form's date row. */
export function formDate(date: string): string {
  const [y, m, d] = date.split('-');
  return y && m && d ? `${d}.${m}.${y}` : date;
}

/** The value a typed field shows back for a stored row: `7.12` km, or `7:05` for a 2000 m. */
export function measuredText(row: Pick<EntryRow, 'protocol' | 'durationSec' | 'distanceM'>): string {
  if (row.protocol === '2000m') {
    const s = Math.round(row.durationSec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  return (row.distanceM / 1000).toFixed(2);
}
