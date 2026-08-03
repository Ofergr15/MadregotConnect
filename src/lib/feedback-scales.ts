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
  if (v == null) return '#475569';
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
