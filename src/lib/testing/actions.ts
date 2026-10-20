/**
 * The three writes the tests screen may make, each scoped to the test identities only
 * (lib/testing/flows TEST_EMAILS) — never a real member's row:
 *   cleanupTestAccounts  everything the +…20 addresses created, so a run starts fresh
 *   fixTestEmail         a sign-up typed with a typo of a test address → the address
 *   createImportCard     the one "from the file" card flow 4 invites
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { TEST_EMAILS, TEST_EMAIL_LIST, editDistance, isTestEmail } from './flows';

export async function cleanupTestAccounts(db: SupabaseClient): Promise<{ deleted: Record<string, number>; blocked: string | null }> {
  const counts: Record<string, number> = {};
  let blocked: string | null = null;
  const { data: aths } = await db.from('athletes').select('id, email').in('email', TEST_EMAIL_LIST);
  const ids = (aths || []).filter((a: any) => isTestEmail(a.email)).map((a: any) => a.id as string);
  const { data: cards } = await db.from('academy_candidates').select('id, email, athlete_id').in('email', TEST_EMAIL_LIST);
  const cardIds = (cards || []).filter((c: any) => isTestEmail(c.email)).map((c: any) => c.id as string);
  const del = async (table: string, column: string, values: string[]) => {
    if (!values.length) return;
    const { data, error } = await db.from(table).delete().in(column, values).select('*');
    if (!error) counts[table] = (counts[table] ?? 0) + (data?.length ?? 0);
    // A row elsewhere still pointing at a test athlete stops the last delete: say which.
    else if (table === 'athletes') blocked = error.message;
  };
  for (const t of ['workout_deliveries', 'push_subscriptions', 'academy_trainee_coaches', 'academy_coach_history', 'academy_coach_decisions', 'academy_tests', 'weekly_plans', 'workout_feedback', 'onboarding_events', 'client_events', 'athlete_activities', 'run_meetup_requests']) await del(t, 'athlete_id', ids);
  if (ids.length) {
    const { data } = await db.from('scheduled_notifications').delete().eq('audience_type', 'athlete').in('audience_id', ids).select('id');
    counts.scheduled_notifications = data?.length ?? 0;
  }
  await del('academy_characterizations', 'candidate_id', cardIds);
  await del('academy_candidate_events', 'candidate_id', cardIds);
  await del('academy_candidates', 'id', cardIds);
  await del('signup_requests', 'email', TEST_EMAIL_LIST);
  await del('athletes', 'id', ids);
  // The sign-in accounts behind them.
  try {
    const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users || []) if (isTestEmail(u.email)) { await db.auth.admin.deleteUser(u.id); counts['auth.users'] = (counts['auth.users'] ?? 0) + 1; }
  } catch { /* the rest is gone; a stale login cannot reach a deleted athlete */ }
  return { deleted: counts, blocked };
}

/** A sign-up whose address is a near miss of a test address (grosfeldofr+club20@) → the address. */
export async function fixTestEmail(db: SupabaseClient, id: string, email: string): Promise<boolean> {
  if (!isTestEmail(email)) return false;
  const { data: row } = await db.from('signup_requests').select('id, email').eq('id', id).maybeSingle();
  if (!row || editDistance(String(row.email).toLowerCase(), email) > 3) return false;
  const { error } = await db.from('signup_requests').update({ email }).eq('id', id);
  return !error;
}

/** Flow 4's card, as the file import makes it — coach Sahar, band 6, results from the "file". */
export async function createImportCard(db: SupabaseClient, importedBy: string | null): Promise<boolean> {
  const email = TEST_EMAILS.import;
  const { data: have } = await db.from('academy_candidates').select('id').eq('email', email).limit(1);
  if (have && have.length) return true;
  const [{ data: coach }, { data: band }] = await Promise.all([
    db.from('athletes').select('id').eq('name', 'Sahar Azar').limit(1),
    db.from('academy_bands').select('id').eq('name', 'דבוקה 6').limit(1),
  ]);
  const coachId = coach?.[0]?.id ?? null;
  const { error } = await db.from('academy_candidates').insert({
    name: 'Test Import', email, phone: '0500000004', source: 'import',
    intake: {
      imported: { city: 'Tel Aviv', height: 178, weight: 72, shirtSize: 'M', shoeSize: '43', goal: 'כרטיס בדיקה — לא מתאמן אמיתי', medicalHistory: 'בריא לחלוטין', hearAbout: 'בדיקה' },
      sheet_results: { '5k': 1290, '10k': 2700, hm: 5940, m: 12600 },
      _import: { rowKey: 'test-import-20', coachNick: 'סהר', coachIds: coachId ? [coachId] : [], requestedBand: 6, requestedBandId: band?.[0]?.id ?? null, staffNote: 'כרטיס בדיקה', marked: true, importedBy: { athleteId: importedBy, email: null } },
    },
  });
  return !error;
}
