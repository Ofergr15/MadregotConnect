import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getClubRecords } from '@/lib/prs/club-records-store';
import { israelToday } from '@/lib/utils';
import { filterRecordTable, type SexFilter } from '@/lib/records/board';
import { readRoster, officialActivityIds } from '@/lib/records/server';
import { podium } from '@/lib/records/podium';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/club/records/podium[?sex=m|f&age=…&races=1] → { podiums: { [bucket]: { label, rows, excluded } } }
// The top three per distance (task 90) — tie rules and the manual-entry gate in lib/records/podium.ts.
// Same gate and the same rows as GET /api/club/records (member; opted-out and pace-hiding runners
// never appear — filterRecordTable drops them), so this widens nothing: it is the first three
// lines of the table every member already reads.
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const supabase = createServerClient();
    const { snapshot } = await getClubRecords(supabase, { refresh: false, readOnly: !!caller.viewingAsBy });
    const url = new URL(request.url);
    const sexQ = url.searchParams.get('sex');
    const sex: SexFilter = sexQ === 'm' || sexQ === 'f' ? sexQ : 'all';
    const age = url.searchParams.get('age') || 'all';
    const racesOnly = url.searchParams.get('races') === '1';

    const [roster, official] = await Promise.all([readRoster(supabase, israelToday()), officialActivityIds(supabase)]);
    const facts = new Map(roster.map((p) => [p.id, p]));
    const isOfficial = (e: { activityId: string | null }) => !!e.activityId && official.has(e.activityId);

    const podiums = Object.fromEntries(snapshot.buckets.map((b) => {
      const table = filterRecordTable(b.entries, facts, isOfficial, { sex, age, racesOnly });
      const officialOf = new Map(table.map((t) => [t.entry, t.official]));
      const { rows, excluded } = podium(b.key, table.map((t) => t.entry));
      return [b.key, {
        label: b.label,
        excluded,
        rows: rows.map(({ place, tied, entry }) => ({
          place, tied, athleteId: entry.athleteId, name: entry.name,
          avatarUrl: facts.get(entry.athleteId)?.avatarUrl ?? null,
          seconds: entry.seconds, date: entry.date, activityId: entry.activityId,
          official: officialOf.get(entry) ?? false, source: entry.source,
        })),
      }];
    }));
    return NextResponse.json({ podiums, asOf: snapshot.computedAt ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('GET /api/club/records/podium failed:', error);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}
