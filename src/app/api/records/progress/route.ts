import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getClubRecords } from '@/lib/prs/club-records-store';
import { PR_BUCKETS } from '@/lib/prs/pr-buckets';
import { israelToday } from '@/lib/utils';
import { bestByMonth, fasterThan, monthAxis, squadMedianSeries, isOnBoard } from '@/lib/records/board';
import { readRoster, myPrivacy, benchmarkBests } from '@/lib/records/server';
import { recordsGate } from '@/lib/records/gate';

export const dynamic = 'force-dynamic';

const MONTHS = 13;
/** A personal best this recent gets the "חדש" tile. */
const NEW_DAYS = 21;

/**
 * GET /api/records/progress?distance=5k|10k|hm|fm — "my progress", SELF ONLY.
 *
 * No athlete parameter: the subject is always the verified caller, so nobody can
 * read anyone else's curve here (mayActFor would let staff in; this screen has no
 * staff use, so it doesn't). `squad` is the anonymous MEDIAN of the caller's own
 * squad's running bests per month — never a name or an id — and is only sent when
 * the caller opted in (`squad_compare`, 195). Opted-out squad-mates are left out of
 * the median too. Also carries `mine`: the caller's best per distance for the
 * tab home's tiles (visible to them even when they hide pace).
 */
export async function GET(request: Request) {
  try {
    const { out, caller } = await recordsGate(request);
    if (out) return out;
    if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 404 });
    const distance = new URL(request.url).searchParams.get('distance') || '5k';
    if (!PR_BUCKETS.some((b) => b.key === distance)) return NextResponse.json({ error: 'bad distance' }, { status: 400 });

    const db = createServerClient();
    const today = israelToday();
    const [{ snapshot }, roster, bench] = await Promise.all([getClubRecords(db), readRoster(db, today), benchmarkBests(db)]);
    const me = roster.find((p) => p.id === caller.athleteId);
    const privacy = myPrivacy(me);
    const breaks = snapshot.breaks ?? {};
    const months = monthAxis(today, MONTHS);
    const daysAgo = (d: string) => Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d.slice(0, 10)}T12:00:00Z`)) / 86400000);

    const mineBreaks = breaks[distance]?.[caller.athleteId] ?? [];
    const series = bestByMonth(mineBreaks, months);

    let squad: { median: Array<number | null>; runners: number; fasterThan: { n: number; of: number } | null } | null = null;
    if (privacy.squadCompare && me?.groupIndex) {
      const mates = roster.filter((p) => p.id !== me.id && p.groupIndex === me.groupIndex && isOnBoard(p));
      const mateSeries = mates.map((p) => bestByMonth(breaks[distance]?.[p.id] ?? [], months)).filter((s) => s.some((v) => v != null));
      const gain = (s: Array<number | null>) => {
        const first = s.find((v) => v != null); const last = s[s.length - 1];
        return first != null && last != null ? first - last : 0;
      };
      squad = {
        median: squadMedianSeries(mateSeries, months),
        runners: mateSeries.length,
        fasterThan: mateSeries.length ? fasterThan(gain(series), mateSeries.map(gain)) : null,
      };
    }

    const mine = PR_BUCKETS.map((b) => {
      const list = breaks[b.key]?.[caller.athleteId!] ?? [];
      const best = list[list.length - 1];
      return best ? { key: b.key, seconds: best.seconds, date: best.date.slice(0, 10), isNew: daysAgo(best.date) <= NEW_DAYS } : null;
    }).filter(Boolean);
    const b = bench.find((x) => x.athleteId === caller.athleteId);
    if (b) mine.push({ key: 'b2000', seconds: b.seconds, date: b.date ?? '', isNew: !!b.date && daysAgo(b.date) <= NEW_DAYS });

    return NextResponse.json({
      enabled: true,
      distance,
      months,
      series,
      breaks: mineBreaks.map((x) => ({ date: x.date.slice(0, 10), seconds: x.seconds })),
      squad,
      mine,
      privacy,
    });
  } catch (err: any) {
    console.error('records/progress error:', err);
    return NextResponse.json({ error: err.message || 'Failed to build progress' }, { status: 500 });
  }
}
