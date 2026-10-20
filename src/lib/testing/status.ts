/**
 * The live status of each hand-test flow: every step's proof, read from the database
 * (sign-up requests, the athlete row, email_log, scheduled_notifications, academy
 * cards, tests). Reads only — the screen polls it every few seconds. Server-side; takes
 * the client so the readiness script can run it outside Next.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { FLOWS, TEST_EMAILS, editDistance, orderStates, type FlowId, type StepStatus } from './flows';

type Row = Record<string, any>;
const first = <T>(rows: T[] | null | undefined): T | null => (rows && rows.length ? rows[0] : null);

async function rows(db: SupabaseClient, table: string, select: string, build: (q: any) => any): Promise<Row[]> {
  try {
    const { data, error } = await build(db.from(table).select(select));
    return error ? [] : ((data || []) as Row[]);
  } catch { return []; }
}

export interface FlowStatus { id: FlowId; email: string; steps: StepStatus[]; athleteId: string | null; staffAlertTo: string[] }

/** What a flow's identity has in the database right now. */
async function factsFor(db: SupabaseClient, email: string) {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const [requests, near, athletes, mails, cards] = await Promise.all([
    rows(db, 'signup_requests', 'id, email, full_name, status, group_id, created_at', (q) => q.eq('email', email).order('created_at', { ascending: false })),
    rows(db, 'signup_requests', 'id, email, full_name, status, created_at', (q) => q.gte('created_at', since).neq('email', email)),
    rows(db, 'athletes', 'id, name, email, status, approved, group_id, first_seen_at, phone_app_opened_at, birth_date, height_cm, shirt_size, pants_size, shoe_size, socks_size, tights_size, garmin_authed_at, notification_prefs, is_academy, academy_coach_id, created_at', (q) => q.eq('email', email)),
    rows(db, 'email_log', 'template, status, created_at', (q) => q.contains('recipients', [email]).order('created_at', { ascending: true })),
    rows(db, 'academy_candidates', 'id, source, invited_at, accepted_at, intake, athlete_id, created_at', (q) => q.eq('email', email).order('created_at', { ascending: false })),
  ]);
  const ath = first(athletes);
  const typo = near.find((r) => r.email && editDistance(String(r.email).toLowerCase(), email) <= 3) || null;
  const [subs, tests, coachRows, coachPushes] = ath ? await Promise.all([
    rows(db, 'push_subscriptions', 'id', (q) => q.eq('athlete_id', ath.id)),
    rows(db, 'academy_tests', 'protocol, status, created_at', (q) => q.eq('athlete_id', ath.id)),
    rows(db, 'academy_trainee_coaches', 'coach_id', (q) => q.eq('athlete_id', ath.id)),
    rows(db, 'scheduled_notifications', 'kind, audience_id, url, created_at', (q) => q.like('url', `%${ath.id}%`)),
  ]) : [[], [], [], []];
  const mail = (t: string | string[]) => mails.find((m) => (Array.isArray(t) ? t : [t]).includes(m.template) && m.status !== 'failed') || null;
  return { req: first(requests), typo, ath, mail, card: first(cards), subs, tests, coachRows, coachPushes };
}

async function staffAlert(db: SupabaseClient, kind: string, name: string, since: string | null) {
  if (!since) return { at: null as string | null, to: [] as string[] };
  const hits = await rows(db, 'scheduled_notifications', 'audience_id, created_at, body_he, title_he', (q) => q.eq('kind', kind).gte('created_at', since));
  const mine = hits.filter((h) => `${h.title_he} ${h.body_he}`.includes(name));
  if (!mine.length) return { at: null, to: [] };
  const ids = [...new Set(mine.map((h) => h.audience_id).filter(Boolean))] as string[];
  const people = ids.length ? await rows(db, 'athletes', 'id, name', (q) => q.in('id', ids)) : [];
  return { at: mine[0].created_at as string, to: people.map((p) => p.name as string) };
}

const setupDone = (a: Row | null) => !!a && !!a.birth_date && !!a.height_cm
  && [a.shirt_size, a.pants_size, a.shoe_size, a.socks_size, a.tights_size].every(Boolean)
  && (!!a.garmin_authed_at || !!a.notification_prefs?.setup?.noWatch);

export async function testStatus(db: SupabaseClient): Promise<FlowStatus[]> {
  const out: FlowStatus[] = [];
  for (const flow of FLOWS) {
    const f = await factsFor(db, flow.email);
    const typoFix = f.typo && !f.req ? { action: 'fix-email', label: `לתקן ל־${flow.email}`, payload: { id: String(f.typo.id), email: flow.email } } : null;
    let facts: Array<{ key: string; done: boolean; at?: string | null; note?: string | null; stuck?: string | null; fix?: StepStatus['fix'] }> = [];
    let alertTo: string[] = [];
    if (flow.id === 'club') {
      const alert = await staffAlert(db, 'signup_request', 'Test Club', f.req?.created_at ?? f.typo?.created_at ?? null);
      alertTo = alert.to;
      const group = f.ath?.group_id ? first(await rows(db, 'groups', 'name', (q) => q.eq('id', f.ath!.group_id))) : null;
      facts = [
        { key: 'signup', done: !!f.req || !!f.ath, at: f.req?.created_at, stuck: f.typo && !f.req && !f.ath ? `נרשם עם ${f.typo.email} — טעות הקלדה, המיילים לא יגיעו אליך` : null, fix: typoFix },
        { key: 'received_mail', done: !!f.mail('registration_received'), at: f.mail('registration_received')?.created_at, note: f.req && !f.mail('registration_received') ? 'לא נשלח לכתובת הזו (אם תוקנה טעות — הוא יצא לכתובת הישנה)' : null },
        { key: 'staff_alert', done: !!alert.at, at: alert.at, note: alert.to.length ? `הגיעה אל: ${alert.to.join(', ')}` : null },
        { key: 'approved', done: !!f.ath?.approved || f.req?.status === 'approved', at: f.ath?.created_at },
        { key: 'approved_mail', done: !!f.mail('registration_approved'), at: f.mail('registration_approved')?.created_at },
        { key: 'signed_in', done: !!f.ath?.first_seen_at, at: f.ath?.first_seen_at, note: f.mail('login_code') ? `קוד נשלח ${f.mail('login_code')!.created_at.slice(11, 16)}` : null },
        { key: 'setup_done', done: setupDone(f.ath), note: f.ath?.first_seen_at && !setupDone(f.ath) ? 'חסרים: ' + [!f.ath.birth_date && 'תאריך לידה', !f.ath.height_cm && 'גובה', ![f.ath.shirt_size, f.ath.pants_size, f.ath.shoe_size, f.ath.socks_size, f.ath.tights_size].every(Boolean) && 'מידות', !(f.ath.garmin_authed_at || f.ath.notification_prefs?.setup?.noWatch) && 'שעון'].filter(Boolean).join(', ') : null },
        { key: 'member', done: !!f.ath?.first_seen_at && f.ath.status === 'active' && !!group, note: group ? String(group.name) : null },
      ];
    } else if (flow.id === 'academy') {
      const alert = await staffAlert(db, 'academy_applicant', 'Test', f.card?.created_at ?? null);
      alertTo = alert.to;
      facts = [
        { key: 'applied', done: !!f.card, at: f.card?.created_at },
        { key: 'applicant_alert', done: !!alert.at || !!f.mail('admin_new_academy_registration'), at: alert.at, note: alert.to.length ? `הגיעה אל: ${alert.to.join(', ')}` : null },
        { key: 'accepted', done: !!f.card?.accepted_at, at: f.card?.accepted_at },
        { key: 'accepted_mail', done: !!f.mail(['academy_accepted', 'academy_approved']), at: f.mail(['academy_accepted', 'academy_approved'])?.created_at },
        { key: 'signed_in', done: !!f.ath?.first_seen_at, at: f.ath?.first_seen_at },
        { key: 'coach_linked', done: f.coachRows.length > 0 },
      ];
    } else {
      const imported = flow.id === 'import';
      const baseline = f.tests.find((t) => t.protocol === 'coach_baseline' || t.protocol === '30min');
      facts = [
        ...(imported ? [{ key: 'card', done: !!f.card && f.card.source === 'import', at: f.card?.created_at }] : []),
        { key: 'invited', done: !!f.card?.invited_at || (!imported && !!f.card), at: f.card?.invited_at ?? f.card?.created_at },
        { key: 'form_mail', done: !!f.mail('academy_existing_form'), at: f.mail('academy_existing_form')?.created_at },
        ...(imported ? [] : [{ key: 'form_filled', done: !!f.card?.intake && Object.keys(f.card.intake).some((k) => !k.startsWith('_') && k !== 'imported' && k !== 'sheet_results') }]),
        { key: imported ? 'confirmed' : 'accepted', done: !!f.card?.accepted_at, at: f.card?.accepted_at },
        { key: 'install_mail', done: !!f.mail('academy_move_in'), at: f.mail('academy_move_in')?.created_at },
        ...(imported ? [] : [{ key: 'coach_setup', done: f.coachPushes.some((p) => String(p.url).includes('setup=1')) }]),
        { key: 'signed_in', done: !!f.ath?.first_seen_at, at: f.ath?.first_seen_at },
        { key: 'baseline', done: !!baseline, at: baseline?.created_at },
      ];
    }
    out.push({ id: flow.id, email: flow.email, steps: orderStates(facts), athleteId: f.ath?.id ?? null, staffAlertTo: alertTo });
  }
  return out;
}

export { TEST_EMAILS };
