// Shared Feel / RPE / pain scale semantics for the workout-feedback views.
// Mirrors TrainingPeaks + Garmin's real scales (see research): Feel is 0–4 as
// stored by the athlete form (😣..😄), difficulty/RPE is 1–10. High feel = good
// (green), high RPE = hard (red). Every color is paired with an emoji/label so
// we never rely on hue alone (mobile PWA, bright outdoor light).

export interface FeelInfo { label: string; emoji: string; hex: string; }

// feel is stored 0..4 (form faces ['😣','😕','😐','🙂','😄']).
const FEEL: Record<number, FeelInfo> = {
  4: { label: 'חזק מאוד', emoji: '😄', hex: '#22c55e' },
  3: { label: 'חזק', emoji: '🙂', hex: '#66bb6a' },
  2: { label: 'רגיל', emoji: '😐', hex: '#fbc02d' },
  1: { label: 'חלש', emoji: '😕', hex: '#f57c00' },
  0: { label: 'חלש מאוד', emoji: '😣', hex: '#d32f2f' },
};

export function feelInfo(v: number | null | undefined): FeelInfo | null {
  if (v == null) return null;
  return FEEL[v] ?? null;
}

// difficulty / RPE 1..10 → band color (green easy → dark-red maximal).
const RPE_HEX = [
  '#22c55e', // 1
  '#43a047', // 2
  '#7cb342', // 3
  '#c0ca33', // 4
  '#fbc02d', // 5
  '#ffb300', // 6
  '#fb8c00', // 7
  '#f4511e', // 8
  '#e53935', // 9
  '#c62828', // 10
];

export function rpeHex(v: number | null | undefined): string {
  if (v == null) return '#BBBBBB';
  const i = Math.min(Math.max(Math.round(v), 1), 10) - 1;
  return RPE_HEX[i];
}

export function rpeLabel(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v <= 2) return 'קל';
  if (v <= 4) return 'קל-בינוני';
  if (v <= 6) return 'בינוני-קשה';
  if (v <= 8) return 'קשה';
  return 'קשה מאוד';
}

/**
 * POST /api/workout-feedback's answers, checked: feel an integer 0–4, difficulty 1–10, pain
 * and wantsFeedback booleans — each also absent or null. One out-of-range feel would lift
 * the average the readiness check holds a pace suggestion on, and a difficulty of 11 would
 * page the staff (≥ 9), so anything else is refused, never clamped. Migration 143 holds the
 * table to the same ranges.
 */
export type FeedbackInput = { feel: number | null; difficulty: number | null; pain: boolean | null; wantsFeedback: boolean | null };

export function parseFeedbackInput(body: Record<string, unknown>): { ok: true; value: FeedbackInput } | { ok: false; field: string } {
  const int = (v: unknown, lo: number, hi: number) => v == null || (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi);
  const bool = (v: unknown) => v == null || typeof v === 'boolean';
  if (!int(body.feel, 0, 4)) return { ok: false, field: 'feel' };
  if (!int(body.difficulty, 1, 10)) return { ok: false, field: 'difficulty' };
  if (!bool(body.pain)) return { ok: false, field: 'pain' };
  if (!bool(body.wantsFeedback)) return { ok: false, field: 'wantsFeedback' };
  return {
    ok: true,
    value: {
      feel: (body.feel as number | null | undefined) ?? null,
      difficulty: (body.difficulty as number | null | undefined) ?? null,
      pain: (body.pain as boolean | null | undefined) ?? null,
      wantsFeedback: (body.wantsFeedback as boolean | null | undefined) ?? null,
    },
  };
}
