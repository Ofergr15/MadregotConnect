/**
 * The unified sign-up's numbers (mockup ~/.cache/madregot/join-flow-mockup.html, Ofer
 * 2026-10-20): "it matters to us what your marathon is — if there is none, the others".
 * A best time becomes a marathon equivalent (Riegel, the standard race-time formula,
 * exponent 1.06), and that picks the pack — or the academy for anyone slower than the
 * club's slowest pack. Pure, so every threshold is a test.
 */

export type Distance = 'marathon' | 'half' | '10k' | '5k';
export const DISTANCE_KM: Record<Distance, number> = { marathon: 42.195, half: 21.0975, '10k': 10, '5k': 5 };
export const DISTANCE_LABEL: Record<Distance, string> = { marathon: 'מרתון', half: 'חצי מרתון', '10k': '10 ק״מ', '5k': '5 ק״מ' };

/** "2:41:20", "41:20", "1:18:40" → seconds; null for anything that is not a time. */
export function parseTime(raw: string): number | null {
  const parts = raw.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return null;
  const [h, m, s] = parts.length === 3 ? parts.map(Number) : [0, ...parts.map(Number)];
  if (m > 59 || s > 59) return null;
  const t = h * 3600 + m * 60 + s;
  return t > 0 ? t : null;
}

/** Seconds → "2:41:20" (or "41:20" under an hour). */
export function clock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** Seconds per km → "3:49". */
export function paceOf(sec: number, km: number): string {
  const p = Math.round(sec / km);
  return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}`;
}

export const kmh = (sec: number, km: number) => Math.round((km / (sec / 3600)) * 10) / 10;

/** A time over `from` as the same effort over `to` (Riegel: t2 = t1 · (d2/d1)^1.06). */
export function equivalent(sec: number, from: Distance, to: Distance): number {
  return sec * (DISTANCE_KM[to] / DISTANCE_KM[from]) ** 1.06;
}

/** The marathon goal in a pack's name — "Group A - SUB 2:30" → 9000 s; null when it has none. */
export function packGoal(name: string): number | null {
  const m = /sub\s*(\d):(\d{2})/i.exec(name);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null;
}

/**
 * The pack a marathon (or its equivalent) fits: the fastest pack whose goal it is
 * within, else the next one up; null when it is slower than every pack — the academy.
 * `packs` are the club's, fastest goal first after sorting.
 */
export function recommend<T extends { goal: number }>(marathonSec: number, packs: T[]): T | null {
  const byGoal = [...packs].sort((a, b) => a.goal - b.goal);
  for (const p of byGoal) if (marathonSec <= p.goal) return p;
  return null;
}
