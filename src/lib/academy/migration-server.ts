import type { createServerClient } from '@/lib/supabase/server';
import { APP_URL, COACH_ID } from '@/lib/constants';
import { testStateOf, type TestRow } from './test-state';
import { migrationRow, type MigrationRow } from './migration';

type Db = ReturnType<typeof createServerClient>;

export type MigrationBoardRow = MigrationRow & {
  athleteId: string; name: string; avatarUrl: string | null; phone: string | null; inviteUrl: string | null; email: string | null;
};

/** Every 'existing' trainee and where they are — the board's read, and the reminder's. */
export async function loadMigrationBoard(supabase: Db, today: string): Promise<MigrationBoardRow[]> {
  const { data: cards, error: cardsErr } = await supabase.from('academy_candidates').select('id, athlete_id').eq('source', 'existing');
  if (cardsErr) return [];
  const cardOf = new Map(((cards || []) as Array<{ id: string; athlete_id: string | null }>).filter((c) => c.athlete_id).map((c) => [c.athlete_id as string, c.id]));
  const ids = [...cardOf.keys()];
  if (!ids.length) return [];

  const [ath, tests, chars, plans] = await Promise.all([
    supabase.from('athletes').select('id, name, avatar_url, status, is_academy, garmin_auth, strava_auth, academy_joined_on, invite_token, phone, email').eq('coach_id', COACH_ID).in('id', ids),
    supabase.from('academy_tests').select('athlete_id, test_date, protocol, status, excluded_reason, duration_sec, distance_m').in('athlete_id', ids),
    supabase.from('academy_characterizations').select('candidate_id, available_days, weekly_km').in('candidate_id', [...cardOf.values()]),
    supabase.from('weekly_plans').select('athlete_id').in('athlete_id', ids).limit(1000),
  ]);
  const testsBy = new Map<string, TestRow[]>();
  for (const t of ((tests.error ? [] : tests.data) || []) as Array<TestRow & { athlete_id: string }>) {
    (testsBy.get(t.athlete_id) ?? testsBy.set(t.athlete_id, []).get(t.athlete_id)!).push(t);
  }
  const answeredCards = new Set(((chars.error ? [] : chars.data) || [] as never[])
    .filter((c: { available_days?: number[] | null; weekly_km?: number | null }) => (c.available_days?.length ?? 0) > 0 && c.weekly_km != null)
    .map((c: { candidate_id: string }) => c.candidate_id));
  const withWeek = new Set(((plans.error ? [] : plans.data) || []).map((p: { athlete_id: string }) => p.athlete_id));

  const rows: MigrationBoardRow[] = [];
  for (const a of ((ath.error ? [] : ath.data) || []) as Array<Record<string, any>>) {
    if (!a.is_academy) continue; // undone or removed since: not on the board
    const ts = testStateOf(testsBy.get(a.id) ?? [], today);
    const test = ts.kind === 'baseline' ? 'ok' : ts.kind === 'ok' ? (ts.old ? 'none' : 'ok') : ts.kind === 'pending' ? 'pending' : ts.kind === 'otherProtocol' ? 'otherProtocol' : 'none';
    const r = migrationRow({
      status: a.status ?? null,
      hasWatch: !!(a.garmin_auth || a.strava_auth),
      test,
      answered: answeredCards.has(cardOf.get(a.id) as string),
      hasPersonalWeek: withWeek.has(a.id),
      movedOn: a.academy_joined_on ?? null,
    }, today);
    rows.push({
      ...r, athleteId: a.id, name: a.name, avatarUrl: a.avatar_url ?? null, phone: a.phone ?? null, email: a.email ?? null,
      inviteUrl: a.status === 'invited' && a.invite_token ? `${APP_URL}/join/${a.invite_token}` : null,
    });
  }
  rows.sort((x, y) => Number(y.stuck) - Number(x.stuck) || x.at - y.at || x.name.localeCompare(y.name));
  return rows;
}
