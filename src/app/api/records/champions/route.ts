import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getClubRecords } from '@/lib/prs/club-records-store';
import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';
import { getActivityWeekStart, israelDateAnchor, israelToday } from '@/lib/utils';
import { clubRecordHistory, monthlyChampions } from '@/lib/records/board';
import { readRoster } from '@/lib/records/server';
import { recordsGate } from '@/lib/records/gate';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * STUB until the plan's per-week run count is wired in: "a full week" = at least
 * this many runs in the activity week. The brief's rule is "hit the plan target
 * COUNT of runs" (never accuracy); the club plans 4–5 sessions, 3 is the floor
 * everyone's plan has.
 */
export const STREAK_TARGET_RUNS = 3;
const STREAK_WEEKS = 8;

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const prev = m === 1 ? iso(y - 1, 12) : iso(y, m - 1);
  const next = m === 12 ? iso(y + 1, 1) : iso(y, m + 1);
  return { prev, start: iso(y, m), next };
}

/**
 * GET /api/records/champions?month=YYYY-MM — this month's three awards: most
 * improved (km vs last month, ≥40 km base), consistency streak (full weeks in a
 * row), new club record. No "most km". Member + `records_tab`; opt-out wins
 * nothing, hidden pace wins no record award (lib/records/board.ts). Computed per
 * request (two months of rows + the cached records snapshot) — no job, no table.
 */
export async function GET(request: Request) {
  try {
    const { out } = await recordsGate(request);
    if (out) return out;
    const today = israelToday();
    const q = new URL(request.url).searchParams.get('month');
    const month = q && /^\d{4}-\d{2}$/.test(q) ? q : today.slice(0, 7);
    const { prev, start, next } = monthBounds(month);
    const db = createServerClient();
    const roster = await readRoster(db, today);
    const ids = roster.map((p) => p.id);

    const rows = ids.length ? await fetchAllRows<RunActivityRow & { athlete_id: string }>((from, to) =>
      db.from('athlete_activities').select('athlete_id, start_time, distance, duration, activity_type')
        .in('athlete_id', ids).gte('start_time', prev).lt('start_time', next).order('id').range(from, to)) : [];
    const monthKm = new Map<string, number>();
    const prevMonthKm = new Map<string, number>();
    for (const r of filterQualifyingRuns(rows)) {
      const target = r.start_time.slice(0, 10) >= start ? monthKm : prevMonthKm;
      target.set(r.athlete_id, (target.get(r.athlete_id) ?? 0) + r.distance / 1000);
    }

    const { byAthlete } = await fetchWeeklyVolume(db, { athleteIds: ids, weeks: STREAK_WEEKS + 1, currentWeekStart: getActivityWeekStart(israelDateAnchor()) });
    const weeksHit = new Map([...byAthlete].map(([id, w]) => [id, w.slice(0, -1).map((b) => b.runs >= STREAK_TARGET_RUNS)]));

    const { snapshot } = await getClubRecords(db);
    const facts = new Map(roster.map((p) => [p.id, p]));
    const monthRecordBreaks = Object.entries(snapshot.breaks ?? {}).flatMap(([bucketKey, byA]) =>
      clubRecordHistory(new Map(Object.entries(byA)), facts)
        .filter((h) => h.improvedBy != null && h.date.slice(0, 10) >= start && h.date.slice(0, 10) < next)
        .map((h) => ({ athleteId: h.athleteId, bucketKey, seconds: h.seconds, date: h.date })));

    const champions = monthlyChampions({ people: roster, monthKm, prevMonthKm, weeksHit, monthRecordBreaks });
    return NextResponse.json({ enabled: true, month, ...champions });
  } catch (err: any) {
    console.error('records/champions error:', err);
    return NextResponse.json(internalErrorBody('Failed to compute champions'), { status: 500 });
  }
}
