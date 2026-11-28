import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getClubRecords } from '@/lib/prs/club-records-store';
import { israelToday } from '@/lib/utils';
import { clubRecordHistory, filterRecordTable, isOnTimeTable, paceHiddenRows, type SexFilter } from '@/lib/records/board';
import { readRoster, officialActivityIds, benchmarkBests } from '@/lib/records/server';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';
// The cold path is the full-history walk in computeClubRecordsSnapshot — thirty
// paged reads plus a laps read. Every other request is a single row out of
// app_settings, so this ceiling is for the once-in-six-hours case.
export const maxDuration = 60;

// GET /api/club/records[?refresh=1]
// The club's records, one ranked table per distance bucket (a798197f, f6c7b8dc).
//
// ── WHY THIS WIDENS NOTHING ────────────────────────────────────────────────
// Gated as `requireMember` (resolveVerifiedCaller), the SAME gate as /api/athletes/[id]/stats, which every
// member already uses to read any teammate's PRs from their profile. So this is
// not new exposure: it is the data the app already shows one athlete at a time,
// arranged as the table two reports asked for. It is still gated rather than
// public — it is the whole active roster by name with their race times, which is
// club-internal, and nothing here should be readable by anyone who knows the URL.
//
// Nothing on it is athlete-specific, so there is no per-caller filtering and no
// `athleteId` parameter: every member sees the same table, which is the point of
// a club record.
//
// שיאים tab (2026-11-21): two runners are now left out of EVERY table and history
// here, for every viewer — `leaderboard_opt_out` (195) and anyone whose
// default_hidden_fields hold `pace` (a record is a time over a distance, i.e. a
// pace). `?sex=m|f&age=35–44&races=1` filter `tables`; `history` is the club
// record over time per bucket (strictly faster breaks across the club); `b2000`
// is the 2000 m benchmark. b23: pace-hiders come back into `tables` as name-only
// rows (`seconds: null`, `paceHidden: true`, no rank, after the ranked rows); ranks
// count visible runners only. `buckets`, `history` and `b2000` still drop them. The unfiltered per-athlete breaks in the snapshot are
// never sent.
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    // An admin viewing the app as somebody (lib/auth/view-as.ts) reads the stored
    // snapshot and never rewrites it.
    const { snapshot, recomputed } = await getClubRecords(supabase, { refresh, readOnly: !!caller.viewingAsBy });

    const url = new URL(request.url);
    const sexQ = url.searchParams.get('sex');
    const sex: SexFilter = sexQ === 'm' || sexQ === 'f' ? sexQ : 'all';
    const age = url.searchParams.get('age') || 'all';
    const racesOnly = url.searchParams.get('races') === '1';

    const [roster, official, bench] = await Promise.all([readRoster(supabase, israelToday()), officialActivityIds(supabase), benchmarkBests(supabase)]);
    const facts = new Map(roster.map((p) => [p.id, p]));
    const names = new Map(roster.map((p) => [p.id, p.name]));
    const visible = (id: string) => isOnTimeTable(facts.get(id) ?? {});
    const isOfficial = (e: { activityId: string | null; source?: string }) => !!e.activityId && official.has(e.activityId);

    const buckets = snapshot.buckets.map((b) => ({ ...b, entries: b.entries.filter((e) => visible(e.athleteId)) }));
    const tables = Object.fromEntries(snapshot.buckets.map((b) => [b.key,
      filterRecordTable(b.entries, facts, isOfficial, { sex, age, racesOnly }).map(({ entry, rank, official: o, ageBand }) => ({
        rank, athleteId: entry.athleteId, name: entry.name, avatarUrl: facts.get(entry.athleteId)?.avatarUrl ?? null, gender: entry.gender, groupId: entry.groupId,
        seconds: entry.seconds, date: entry.date, activityId: entry.activityId, official: o, ageBand,
      }) as Record<string, unknown>).concat(
        // b23: pace-hiders as name-only rows, after every ranked row — see paceHiddenRows.
        // Built from the roster, never from the entry, so no time/date/run can ride along.
        paceHiddenRows(b.entries, facts, { sex, age, racesOnly }).map((h) => ({
          rank: null, athleteId: h.athleteId, name: names.get(h.athleteId) ?? '',
          avatarUrl: facts.get(h.athleteId)?.avatarUrl ?? null, gender: facts.get(h.athleteId)?.gender ?? null,
          groupId: facts.get(h.athleteId)?.groupId ?? null, seconds: null, paceHidden: true,
        })),
      ),
    ]));
    const b2000 = filterRecordTable(bench.map((x) => ({ ...x, activityId: null })), facts, () => true, { sex, age })
      .map(({ entry, rank, ageBand }) => ({ rank, athleteId: entry.athleteId, name: names.get(entry.athleteId) ?? '', gender: facts.get(entry.athleteId)?.gender ?? null, seconds: entry.seconds, date: entry.date, official: true, ageBand }));
    const history = Object.fromEntries(Object.entries(snapshot.breaks ?? {}).map(([key, byAthlete]) => [key,
      clubRecordHistory(new Map(Object.entries(byAthlete)), facts).map((h) => ({ ...h, name: names.get(h.athleteId) ?? '', official: isOfficial(h) })),
    ]));
    const ageBands = [...new Set(roster.map((p) => p.ageBand).filter((a): a is string => !!a))].sort();

    const { breaks: _raw, ...rest } = snapshot;
    void _raw;
    return NextResponse.json({ ...rest, buckets, tables, b2000, history, ageBands, filters: { sex, age, racesOnly }, recomputed });
  } catch (err: any) {
    console.error('Club records error:', err);
    return NextResponse.json(internalErrorBody('Failed to compute club records'), { status: 500 });
  }
}
