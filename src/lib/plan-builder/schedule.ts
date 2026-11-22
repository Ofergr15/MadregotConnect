import { addDaysToDateStr } from '@/lib/utils';
import { DEFAULT_PUBLISH_HOUR_IL, DEFAULT_PUBLISH_WEEKDAY } from './constants';

function israelHour(d: Date): { date: string; hour: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${v('year')}-${v('month')}-${v('day')}`, hour: Number(v('hour')) };
}

/** `hour`:00 Israel time on `date` (YYYY-MM-DD), as a UTC ISO string. DST-safe. */
export function israelWallToUtc(date: string, hour: number): string {
  for (const off of [2, 3]) {
    const guess = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
    guess.setUTCHours(guess.getUTCHours() - off);
    const il = israelHour(guess);
    if (il.date === date && il.hour === hour) return guess.toISOString();
  }
  throw new Error(`no Israel ${hour}:00 on ${date}`);
}

/** Default scheduled publish for a plan week (Sunday): DEFAULT_PUBLISH_WEEKDAY of the week before. */
export function defaultPublishAt(weekStart: string): string {
  return israelWallToUtc(addDaysToDateStr(weekStart, DEFAULT_PUBLISH_WEEKDAY - 7), DEFAULT_PUBLISH_HOUR_IL);
}

/** Copy last week: same steps; paces shifted by `shiftSec` (0 = untouched). */
export function shiftPaces<T>(body: T, shiftSec: number): T {
  if (!shiftSec) return body;
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const [k, x] of Object.entries(v)) {
        o[k] = /^targetPace(Min|Max)PerKm$|^(min|max)$/.test(k) && typeof x === 'number' ? x + shiftSec : walk(x);
      }
      return o;
    }
    return v;
  };
  return walk(body);
}
