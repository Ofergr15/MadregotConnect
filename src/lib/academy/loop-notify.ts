/**
 * The academy's quiet loop, made audible (launch report BL8 / N7).
 *
 * Every one of these events used to happen with no push and no inbox row: a test
 * invitation, the trainee confirming a slot, the trainee submitting a test, the coach
 * approving it, the analysis being sent, a band being set, a plan saved without a watch
 * (or a Garmin push that failed), a pace update, a coach picked at accept, a missed-week
 * rewrite. Each send below is one `notifyAthlete` call (push + inbox row) and is
 * best-effort: the event already happened, and a failed push must never turn a saved
 * test or a sent plan into an error. Callers `await` them inside a try, or chain
 * `.catch()`.
 *
 * The copy lives here rather than in copy.ts only because these ten belong together and
 * nothing else reads them; they follow copy.ts's shape (per language, a function each).
 * Hebrew addresses the trainee in the plural/neutral form the app uses where gender is
 * unknown.
 */
import { notifyAthlete } from '@/lib/push';
import type { NotificationLocale } from '@/lib/notifications/locale';
import type { PushCopy } from '@/lib/notifications/copy';
import { academyBoardUrl, academyTestUrl, academyThreadUrl } from './deep-links';

type Db = { from: (table: string) => any };

const first = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || '';

/** The kinds this module sends. Mapped to a preference category in notifications/prefs.ts. */
export const LOOP_KINDS = {
  testInvite: 'academy_test_invite',
  testConfirmed: 'academy_test_confirmed',
  testSubmitted: 'academy_test_submitted',
  testApproved: 'academy_test_approved',
  testAnalysis: 'academy_test_analysis',
  bandSet: 'academy_band_set',
  planSaved: 'academy_plan_saved',
  paceUpdate: 'academy_pace_update',
  missedWeek: 'academy_missed_week',
  removed: 'academy_removed',
} as const;

// ── Copy ────────────────────────────────────────────────────────────────────

export function testInviteCopy(locale: NotificationLocale, p: { coach?: string | null }): PushCopy {
  const who = first(p.coach);
  return locale === 'he'
    ? { title: '🎯 הוזמנת לטסט', body: `${who ? `${who} מזמין אותך לטסט. ` : ''}לחיצה פותחת את ההזמנה לבחירת מועד.` }
    : { title: '🎯 You are invited to a test', body: `${who ? `${who} invited you. ` : ''}Tap to pick a time.` };
}

export function testConfirmedCopy(locale: NotificationLocale, p: { trainee?: string | null; slot?: string | null }): PushCopy {
  const who = (p.trainee || '').trim() || (locale === 'he' ? 'מתאמן' : 'A trainee');
  const slot = (p.slot || '').trim();
  return locale === 'he'
    ? { title: `🎯 ${who} אישר/ה מועד לטסט`, body: slot ? `${slot}. לחיצה פותחת את הטסטים.` : 'לחיצה פותחת את הטסטים.' }
    : { title: `🎯 ${who} confirmed a test time`, body: slot ? `${slot}. Tap to open the tests.` : 'Tap to open the tests.' };
}

export function testSubmittedCopy(locale: NotificationLocale, p: { trainee?: string | null }): PushCopy {
  const who = (p.trainee || '').trim() || (locale === 'he' ? 'מתאמן' : 'A trainee');
  return locale === 'he'
    ? { title: `🎯 ${who} שלח/ה תוצאת טסט`, body: 'מחכה לאישור שלך. לחיצה פותחת את הטסטים.' }
    : { title: `🎯 ${who} sent a test result`, body: 'Waiting for your approval. Tap to open the tests.' };
}

export function testApprovedCopy(locale: NotificationLocale): PushCopy {
  return locale === 'he'
    ? { title: '🎯 הטסט שלך אושר', body: 'הקצבים שלך מעודכנים לפיו. לחיצה פותחת את הטסטים.' }
    : { title: '🎯 Your test was approved', body: 'Your paces now follow it. Tap to open your tests.' };
}

export function testAnalysisCopy(locale: NotificationLocale, p: { coach?: string | null }): PushCopy {
  const who = first(p.coach);
  return locale === 'he'
    ? { title: '🎯 ניתוח הטסט שלך מחכה', body: `${who ? `${who} שלח/ה ` : 'נשלח '}את הניתוח לשיחה שלכם. לחיצה פותחת אותה.` }
    : { title: '🎯 Your test analysis is in', body: `${who ? `${who} sent it ` : 'It was sent '}to your conversation. Tap to open it.` };
}

export function bandSetCopy(locale: NotificationLocale, p: { band?: string | null }): PushCopy {
  const band = (p.band || '').trim();
  return locale === 'he'
    ? { title: '🎓 נקבעה לך דבוקה', body: `${band ? `${band}. ` : ''}הקצבים והיעד שלך מעודכנים. לחיצה פותחת את האקדמיה.` }
    : { title: '🎓 Your band is set', body: `${band ? `${band}. ` : ''}Your paces and goal are updated. Tap to open the academy.` };
}

export function planSavedCopy(locale: NotificationLocale, p: { days: number; failedWatch: boolean }): PushCopy {
  const he = p.days > 1 ? `${p.days} אימונים חדשים בתוכנית שלך` : 'אימון חדש בתוכנית שלך';
  const en = p.days > 1 ? `${p.days} new sessions in your plan` : 'A new session in your plan';
  return locale === 'he'
    ? { title: `📋 ${he}`, body: p.failedWatch ? 'לא הצלחנו לשים אותו בשעון, אבל הוא באפליקציה. לחיצה פותחת אותו.' : 'לחיצה פותחת אותו בלוח.' }
    : { title: `📋 ${en}`, body: p.failedWatch ? "It didn't reach your watch, but it's in the app. Tap to open it." : 'Tap to open it on your board.' };
}

export function paceUpdateCopy(locale: NotificationLocale, p: { faster: boolean | null }): PushCopy {
  return locale === 'he'
    ? { title: '⚡ הקצבים שלך עודכנו', body: `${p.faster === true ? 'המאמן העלה לך קצב. ' : p.faster === false ? 'המאמן הוריד לך קצב. ' : ''}האימונים הבאים כבר בקצבים החדשים.` }
    : { title: '⚡ Your paces were updated', body: `${p.faster === true ? 'Your coach sped you up. ' : p.faster === false ? 'Your coach eased your paces. ' : ''}Your next sessions already use them.` };
}

export function missedWeekCopy(locale: NotificationLocale): PushCopy {
  return locale === 'he'
    ? { title: '📋 התוכנית שלך עודכנה', body: 'המאמן סידר מחדש את האימונים הבאים. לחיצה פותחת את הלוח.' }
    : { title: '📋 Your plan was updated', body: 'Your coach rearranged your next sessions. Tap to open your board.' };
}

export function removedCopy(locale: NotificationLocale): PushCopy {
  return locale === 'he'
    ? { title: '🎓 סיימת את האקדמיה', body: 'החשבון שלך במועדון נשאר כמו שהוא. לכל שאלה אפשר לפנות למאמן.' }
    : { title: '🎓 Your academy membership ended', body: 'Your club account stays as it is. Ask your coach with any question.' };
}

// ── Recipients ──────────────────────────────────────────────────────────────

/** The trainee's coaches (all equal since 135), or the academy managers when they have none. */
export async function coachesOrManagers(supabase: Db, athleteId: string): Promise<string[]> {
  const { coachIdsOf } = await import('./trainee-coaches');
  let ids = (await coachIdsOf(supabase as never, athleteId).catch(() => [] as string[])).filter((id) => id !== athleteId);
  if (!ids.length) {
    const { academyManagerIds } = await import('@/lib/notifications/staff');
    ids = (await academyManagerIds()).filter((id) => id !== athleteId);
  }
  return [...new Set(ids)];
}

async function nameOf(supabase: Db, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  try {
    const { data } = await supabase.from('athletes').select('name').eq('id', id).maybeSingle();
    return (data as { name?: string } | null)?.name ?? null;
  } catch {
    return null;
  }
}

function quiet(p: Promise<unknown>, what: string): Promise<void> {
  return p.then(() => undefined, (err) => { console.error(`academy loop push (${what}) failed:`, err); });
}

// ── Sends: to the trainee ───────────────────────────────────────────────────

export function notifyTestInvited(supabase: Db, p: { athleteId: string; actorId: string | null }): Promise<void> {
  return quiet((async () => {
    const coach = await nameOf(supabase, p.actorId);
    await notifyAthlete({
      athleteId: p.athleteId, kind: LOOP_KINDS.testInvite, actorAthleteId: p.actorId,
      url: academyTestUrl({ recipientIsStaff: false }), tag: `academy-test-${p.athleteId}`, category: 'coach',
      copy: (l) => testInviteCopy(l, { coach }),
    });
  })(), 'test invite');
}

export function notifyTestApproved(p: { athleteId: string; actorId: string | null }): Promise<void> {
  return quiet(notifyAthlete({
    athleteId: p.athleteId, kind: LOOP_KINDS.testApproved, actorAthleteId: p.actorId,
    url: academyTestUrl({ recipientIsStaff: false }), tag: `academy-test-${p.athleteId}`, category: 'coach',
    copy: (l) => testApprovedCopy(l),
  }), 'test approved');
}

export function notifyTestAnalysis(supabase: Db, p: { athleteId: string; actorId: string | null }): Promise<void> {
  return quiet((async () => {
    const coach = await nameOf(supabase, p.actorId);
    await notifyAthlete({
      athleteId: p.athleteId, kind: LOOP_KINDS.testAnalysis, actorAthleteId: p.actorId,
      url: academyThreadUrl({ recipientIsStaff: false, traineeId: p.athleteId }), tag: `academy-thread-${p.athleteId}`, category: 'coach',
      copy: (l) => testAnalysisCopy(l, { coach }),
    });
  })(), 'test analysis');
}

export function notifyBandSet(p: { athleteId: string; actorId: string | null; band?: string | null }): Promise<void> {
  return quiet(notifyAthlete({
    athleteId: p.athleteId, kind: LOOP_KINDS.bandSet, actorAthleteId: p.actorId,
    url: academyBoardUrl(), tag: `academy-band-${p.athleteId}`, category: 'coach',
    copy: (l) => bandSetCopy(l, { band: p.band ?? null }),
  }), 'band set');
}

/**
 * A plan reached the trainee's APP but no watch told them: no Garmin at all, or a Garmin
 * push that failed (a successful one sends `plan_pushed` from push-week). `date` = the
 * first day sent, which the board opens on.
 */
export function notifyPlanSaved(p: { athleteId: string; actorId: string | null; date: string | null; days: number; failedWatch: boolean }): Promise<void> {
  return quiet(notifyAthlete({
    athleteId: p.athleteId, kind: LOOP_KINDS.planSaved, actorAthleteId: p.actorId,
    url: academyBoardUrl({ open: p.date }), tag: `academy-plan-${p.athleteId}`, category: 'program',
    copy: (l) => planSavedCopy(l, { days: Math.max(1, p.days), failedWatch: p.failedWatch }),
  }), 'plan saved');
}

export function notifyPaceUpdate(p: { athleteId: string; actorId: string | null; faster: boolean | null }): Promise<void> {
  return quiet(notifyAthlete({
    athleteId: p.athleteId, kind: LOOP_KINDS.paceUpdate, actorAthleteId: p.actorId,
    url: academyBoardUrl(), tag: `academy-pace-${p.athleteId}`, category: 'coach',
    copy: (l) => paceUpdateCopy(l, { faster: p.faster }),
  }), 'pace update');
}

export function notifyMissedWeek(p: { athleteId: string; actorId: string | null; date: string | null }): Promise<void> {
  return quiet(notifyAthlete({
    athleteId: p.athleteId, kind: LOOP_KINDS.missedWeek, actorAthleteId: p.actorId,
    url: academyBoardUrl({ open: p.date }), tag: `academy-plan-${p.athleteId}`, category: 'program',
    copy: (l) => missedWeekCopy(l),
  }), 'missed week');
}

export function notifyRemoved(p: { athleteId: string; actorId: string | null }): Promise<void> {
  return quiet(notifyAthlete({
    athleteId: p.athleteId, kind: LOOP_KINDS.removed, actorAthleteId: p.actorId,
    url: '/dashboard', tag: 'academy-coach', category: 'coach',
    copy: (l) => removedCopy(l),
  }), 'removed');
}

// ── Sends: to the coaches ───────────────────────────────────────────────────

export function notifyTestConfirmed(supabase: Db, p: { athleteId: string; slot?: string | null }): Promise<void> {
  return quiet((async () => {
    const [to, trainee] = await Promise.all([coachesOrManagers(supabase, p.athleteId), nameOf(supabase, p.athleteId)]);
    await Promise.all(to.map((id) => notifyAthlete({
      athleteId: id, kind: LOOP_KINDS.testConfirmed, actorAthleteId: p.athleteId,
      url: academyTestUrl({ recipientIsStaff: true }), tag: `academy-test-${p.athleteId}`, category: 'coach',
      copy: (l) => testConfirmedCopy(l, { trainee, slot: p.slot ?? null }),
    }).catch(() => {})));
  })(), 'test confirmed');
}

export function notifyTestSubmitted(supabase: Db, p: { athleteId: string }): Promise<void> {
  return quiet((async () => {
    const [to, trainee] = await Promise.all([coachesOrManagers(supabase, p.athleteId), nameOf(supabase, p.athleteId)]);
    await Promise.all(to.map((id) => notifyAthlete({
      athleteId: id, kind: LOOP_KINDS.testSubmitted, actorAthleteId: p.athleteId,
      url: academyTestUrl({ recipientIsStaff: true }), tag: `academy-test-${p.athleteId}`, category: 'coach',
      copy: (l) => testSubmittedCopy(l, { trainee }),
    }).catch(() => {})));
  })(), 'test submitted');
}
