// אלופי המדרגות (mockup ~/.cache/madregot/champions, Ofer 10-20): the club's top 10 per
// race distance, from official race times only (race_results, migration 163). Men and
// women apart, and together ("if the women are fast enough" — a mixed list does that by
// itself). This year and all time. Pure: the routes feed it rows.

export type ChampDistance = '5k' | '10k' | 'half' | 'marathon';
export const CHAMP_DISTANCES: ChampDistance[] = ['5k', '10k', 'half', 'marathon'];
export const DISTANCE_LABEL: Record<ChampDistance, string> = { '5k': '5 ק״מ', '10k': '10 ק״מ', half: 'חצי', marathon: 'מרתון' };
export const DISTANCE_LONG: Record<ChampDistance, string> = { '5k': '5 ק״מ', '10k': '10 ק״מ', half: 'חצי מרתון', marathon: 'מרתון' };
export type ChampSex = 'men' | 'women' | 'all';
export type ChampScope = 'year' | 'all';
export const TOP = 10;

export interface ResultRow {
  id: string; athleteId: string; name: string; avatarUrl: string | null;
  gender: string | null; pack: number | null;
  distance: ChampDistance; seconds: number; raceName: string | null; raceDate: string;
}
export interface Ranked extends ResultRow { rank: number; isNew: boolean }
export interface Board { top: Ranked[]; me: Ranked | null }

/** "Group B - SUB 2:35" → 2. A pack is a number to the members (Ofer: "1 2 3, not א ב ג"). */
export function packNumber(groupName: string | null | undefined): number | null {
  const m = /group\s+([a-z])\b/i.exec(groupName || '') ?? /^([a-z])\b/i.exec((groupName || '').trim());
  if (m) return m[1].toUpperCase().charCodeAt(0) - 64;
  const n = /(\d+)/.exec(groupName || '');
  return n ? Number(n[1]) : null;
}

/** Which race a watch run looks like, by its distance — a suggestion only. */
export function distanceOf(meters: number | null | undefined): ChampDistance | null {
  const km = (meters || 0) / 1000;
  if (km >= 4.85 && km <= 5.3) return '5k';
  if (km >= 9.8 && km <= 10.5) return '10k';
  if (km >= 20.9 && km <= 21.6) return 'half';
  if (km >= 41.9 && km <= 43) return 'marathon';
  return null;
}

const isWoman = (g: string | null) => /^(f|female|woman|נקבה|אישה)$/i.test((g || '').trim());
const isMan = (g: string | null) => /^(m|male|man|זכר|גבר)$/i.test((g || '').trim());

/**
 * One board: each person's best result in the slice, fastest first; a tie goes to
 * the earlier race. `isNew` = raced in the last 30 days.
 */
export function board(rows: ResultRow[], o: { distance: ChampDistance; sex: ChampSex; scope: ChampScope; today: string; viewerId?: string | null }): Board {
  const year = o.today.slice(0, 4);
  const best = new Map<string, ResultRow>();
  for (const r of rows) {
    if (r.distance !== o.distance) continue;
    if (o.scope === 'year' && r.raceDate.slice(0, 4) !== year) continue;
    if (o.sex === 'men' && !isMan(r.gender)) continue;
    if (o.sex === 'women' && !isWoman(r.gender)) continue;
    const b = best.get(r.athleteId);
    if (!b || r.seconds < b.seconds || (r.seconds === b.seconds && r.raceDate < b.raceDate)) best.set(r.athleteId, r);
  }
  const since = new Date(`${o.today}T12:00:00Z`); since.setUTCDate(since.getUTCDate() - 30);
  const fresh = since.toISOString().slice(0, 10);
  const all = [...best.values()]
    .sort((a, b) => a.seconds - b.seconds || a.raceDate.localeCompare(b.raceDate) || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, rank: i + 1, isNew: r.raceDate >= fresh }));
  const me = o.viewerId ? all.find((r) => r.athleteId === o.viewerId) ?? null : null;
  return { top: all.slice(0, TOP), me };
}

/** Where a new result lands on the all-time mixed-by-sex board it belongs to — for "נכנס למקום 4". */
export function placeOf(rows: ResultRow[], result: ResultRow, today: string): number | null {
  const sex: ChampSex = isWoman(result.gender) ? 'women' : isMan(result.gender) ? 'men' : 'all';
  const b = board([...rows.filter((r) => r.id !== result.id), result], { distance: result.distance, sex, scope: 'all', today });
  const at = b.top.find((r) => r.id === result.id);
  return at ? at.rank : null;
}

/** "1:09:58" / "16:42". */
export function fmtRaceTime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1:09:58" / "16:42" / "69:58" → seconds; null when it isn't a time. */
export function parseRaceTime(t: string): number | null {
  const p = t.trim().split(':');
  if (p.length < 2 || p.length > 3 || p.some((x) => !/^\d{1,3}$/.test(x))) return null;
  const n = p.map(Number);
  const sec = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
  return sec > 0 ? sec : null;
}

export const enteredVerb = (gender: string | null) => (isWoman(gender) ? 'נכנסה' : 'נכנס');
