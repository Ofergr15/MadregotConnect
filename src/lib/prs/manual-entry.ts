// Server validation of a manually entered record (night task 58). Layered on
// lib/prs/overrides.ts, which already owns the per-bucket plausibility bounds; this
// file makes the INPUT safe before it gets there, because the input is a phone
// keyboard that is usually set to Hebrew:
//
//  • iOS/Android insert invisible bidi marks (U+200E/U+200F, U+061C) around digits
//    typed in an RTL field, so "‏41:58" failed to parse and the runner was told
//    their time "must look like 41:58" — next to the 41:58 they typed.
//  • A Hebrew keyboard's numeric row can produce Arabic-Indic or Persian digits on
//    some layouts, and a fullwidth colon from IME autocorrect.
//  • Embedding / override controls (U+202A–U+202E, U+2066–U+2069) in a NOTE can
//    visually reorder text shown to staff; they are stripped from stored notes.

const BIDI_MARKS = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const ARABIC_INDIC = /[\u0660-\u0669]/g;
const PERSIAN = /[\u06F0-\u06F9]/g;

/** Normalise a typed time string: drop bidi marks, map foreign digits and colons to ASCII. */
export function normaliseTimeInput(raw: string): string {
  return raw
    .replace(BIDI_MARKS, '')
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\uFF1A\uFE55\u2236]/g, ':')
    .replace(/\s+/g, '')
    .trim();
}

export const NOTE_MAX = 200;

/** Store-safe note: no bidi embedding/override controls, collapsed whitespace, capped. Null when empty. */
export function cleanNote(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(BIDI_MARKS, '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, NOTE_MAX) : null;
}

export type DateProblem = 'bad-date' | 'future-date' | 'too-old';

/**
 * `achievedOn` must be a real calendar date, not after `today`, not before 1950.
 * Returns the normalised date (or null for "don't remember"), or a problem code.
 */
export function checkAchievedOn(raw: unknown, today: string): { ok: true; value: string | null } | { ok: false; code: DateProblem } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const s = normaliseTimeInput(String(raw));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, code: 'bad-date' };
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false, code: 'bad-date' };
  if (s > today) return { ok: false, code: 'future-date' };
  if (s < '1950-01-01') return { ok: false, code: 'too-old' };
  return { ok: true, value: s };
}

export type OverrideAction = 'set' | 'hide' | 'clear';

/** The audit row for one edit (migration 232). */
export function overrideAuditRow(p: {
  athleteId: string; bucketKey: string; action: OverrideAction; seconds: number | null;
  previousSeconds: number | null; achievedOn: string | null; changedBy: string | null;
}) {
  return {
    athlete_id: p.athleteId,
    bucket_key: p.bucketKey,
    action: p.action,
    seconds: p.seconds,
    previous_seconds: p.previousSeconds,
    achieved_on: p.achievedOn,
    changed_by: p.changedBy,
    changed_at: new Date().toISOString(),
  };
}
