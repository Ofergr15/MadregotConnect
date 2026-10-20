/**
 * "Are we ready to test by hand?" — read-only checks over the live database and the
 * server's own configuration, each PASS / WARN / FAIL with a reason. Shown at the top
 * of /dashboard/tests and printed by `npm run check:signup-ready`. Reads only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { TEST_EMAIL_LIST } from './flows';

export type Level = 'PASS' | 'WARN' | 'FAIL';
export interface Check { level: Level; label: string; detail: string }

const TEMPLATES = ['registration_received', 'registration_approved', 'login_code', 'admin_new_signup_request', 'academy_existing_form', 'academy_move_in', 'academy_accepted', 'admin_new_academy_registration'];
const OLD_TEST_EMAILS = ['grosfeldofer+test1@gmail.com', 'grosfeldofer+test2@gmail.com', 'grosfeldofer+test3@gmail.com'];

async function probe(db: SupabaseClient, table: string, column: string): Promise<boolean> {
  const { error } = await db.from(table).select(column).limit(1);
  return !error;
}

export async function readiness(db: SupabaseClient, opts: { env?: Record<string, string | undefined>; superUserEmail: string; flags: { setupGate: boolean; joinUnified: boolean } }): Promise<Check[]> {
  const out: Check[] = [];
  const add = (level: Level, label: string, detail: string) => out.push({ level, label, detail });

  // Email: the server's own sender when it can see it, and the proof — recent sends.
  const env = opts.env;
  if (env) {
    const from = env.RESEND_FROM_EMAIL?.trim();
    if (!env.RESEND_API_KEY) add('FAIL', 'שליחת מיילים', 'אין RESEND_API_KEY בשרת');
    else if (!from || from.includes('resend.dev')) add('FAIL', 'שליחת מיילים', 'השולח הוא כתובת הבדיקה של Resend — מיילים לא יגיעו');
  }
  const { data: recent } = await db.from('email_log').select('template, status, from_address, created_at').order('created_at', { ascending: false }).limit(200);
  const sent = (recent || []).filter((r: any) => r.status === 'sent');
  const failed = (recent || []).filter((r: any) => r.status === 'failed').length;
  if (!sent.length) add('FAIL', 'שליחת מיילים', 'אין מייל שנשלח לאחרונה');
  else add(failed > sent.length / 5 ? 'WARN' : 'PASS', 'שליחת מיילים', `${sent.length} נשלחו לאחרונה מ־${String(sent[0].from_address || '').replace(/.*</, '').replace('>', '')}${failed ? ` · ${failed} נכשלו` : ''}`);
  const seen = new Set((recent || []).map((r: any) => r.template));
  const never = TEMPLATES.filter((t) => !seen.has(t));
  add(never.length ? 'WARN' : 'PASS', 'תבניות המייל בזרימות', never.length ? `עוד לא נשלחו אף פעם לאחרונה: ${never.join(', ')} — הבדיקה תהיה הפעם הראשונה` : 'כולן נשלחו לאחרונה');

  // Who hears about a new sign-up: the routing table, and whether the super user is on it.
  const { data: su } = await db.from('athletes').select('id, name, role, is_super_user, email').eq('is_super_user', true);
  const me = (su || []).find((a: any) => String(a.email).toLowerCase() === opts.superUserEmail);
  const { data: routing } = await db.from('notification_routing').select('kind, role, enabled').in('kind', ['signup_request', 'academy_applicant', 'feedback_alert']);
  for (const kind of ['signup_request', 'academy_applicant']) {
    const roles = (routing || []).filter((r: any) => r.kind === kind && r.enabled).map((r: any) => r.role);
    const { data: people } = roles.length ? await db.from('athletes').select('id, name').in('role', roles) : { data: [] as any[] };
    const list: Array<{ id: string; name: string }> = [...(people || [])];
    // Admin-routed alerts also reach the owner's own account (lib/notifications/routing).
    if (roles.includes('admin') && me) list.push({ id: me.id, name: me.name });
    // The applicant alert also always reaches the academy managers and the owner's own
    // account (lib/notifications/staff academyManagerIds).
    if (kind === 'academy_applicant') {
      const { data: mgr } = await db.from('athletes').select('id, name').contains('extra_roles', ['academy_manager']);
      list.push(...(mgr || []), ...(me ? [{ id: me.id, name: me.name }] : []));
    }
    const names = [...new Set(list.map((p) => p.name))];
    const reachesMe = !!me && list.some((p) => p.id === me.id);
    add(reachesMe ? 'PASS' : 'WARN', kind === 'signup_request' ? 'התראה על בקשת הרשמה' : 'התראה על מועמד לאקדמיה',
      `מגיעה אל: ${names.join(', ') || 'אף אחד'}${me && !reachesMe ? ` — לא לחשבון שלך (${me.name}, תפקיד ${me.role})` : ''}`);
  }

  // Roles the academy flows need.
  const { data: coaches } = await db.from('athletes').select('name, role, extra_roles').or('role.eq.academy_coach,extra_roles.cs.{academy_coach}');
  add((coaches || []).length >= 2 ? 'PASS' : 'FAIL', 'מאמני אקדמיה', (coaches || []).map((c: any) => c.name).join(', ') || 'אין');
  const { data: managers } = await db.from('athletes').select('name').contains('extra_roles', ['academy_manager']);
  add((managers || []).length ? 'PASS' : 'WARN', 'מנהל אקדמיה', (managers || []).map((m: any) => m.name).join(', ') || 'אין (רק מנהל־על)');

  // Bands and their meanings.
  const { data: bands } = await db.from('academy_bands').select('name, pace_profile');
  const noDesc = (bands || []).filter((b: any) => !b.pace_profile?.description).map((b: any) => b.name);
  add(noDesc.length ? 'WARN' : 'PASS', 'משמעות לכל דבוקה באקדמיה', noDesc.length ? `חסר ל: ${noDesc.join(', ')}` : `${(bands || []).length} דבוקות`);

  // Migrations the flows read, proven by their columns.
  const probes: Array<[string, string, string]> = [['155 גובה ומשקל', 'athletes', 'height_cm'], ['158 פרטי הרשמה', 'signup_requests', 'intake'], ['159 ספר אימונים', 'academy_workout_library', 'kind_confirmed']];
  for (const [label, t, c] of probes) add((await probe(db, t, c)) ? 'PASS' : 'FAIL', `מיגרציה ${label}`, `${t}.${c}`);

  // The switches.
  add(opts.flags.joinUnified ? 'PASS' : 'WARN', 'הרשמה מאוחדת', opts.flags.joinUnified ? 'פעילה לכולם' : 'כבויה');
  add(opts.flags.setupGate ? 'PASS' : 'WARN', 'הגדרה חובה לחברים חדשים', opts.flags.setupGate ? 'פעילה' : 'כבויה');
  const { data: reg } = await db.from('app_settings').select('value').eq('key', 'academy_registration_open').maybeSingle();
  add(reg?.value === 'closed' ? 'WARN' : 'PASS', 'הרשמה לאקדמיה', reg?.value === 'closed' ? 'סגורה — מועמד חדש לא יוכל להירשם' : 'פתוחה');

  // Test identities: today's are free or in progress; yesterday's leftovers are named.
  const { data: leftovers } = await db.from('athletes').select('email, name, status').in('email', OLD_TEST_EMAILS);
  add((leftovers || []).length ? 'WARN' : 'PASS', 'חשבונות בדיקה ישנים', (leftovers || []).length ? `${(leftovers || []).map((l: any) => `${l.email} (${l.name})`).join(', ')} — לא להשתמש בהם` : 'אין');
  const { data: current } = await db.from('athletes').select('email').in('email', TEST_EMAIL_LIST);
  const { data: currentReq } = await db.from('signup_requests').select('email').in('email', TEST_EMAIL_LIST);
  const inUse = new Set([...(current || []), ...(currentReq || [])].map((r: any) => r.email));
  add('PASS', 'חשבונות הבדיקה של היום', inUse.size ? `בשימוש: ${[...inUse].join(', ')} — "ניקוי" מתחיל מחדש` : 'פנויים');
  return out;
}

export const summarise = (checks: Check[]) => ({
  fail: checks.filter((c) => c.level === 'FAIL').length,
  warn: checks.filter((c) => c.level === 'WARN').length,
  pass: checks.filter((c) => c.level === 'PASS').length,
});
