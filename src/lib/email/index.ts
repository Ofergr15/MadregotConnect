import { APP_URL, APPROVER_EMAILS } from '@/lib/constants';
import { renderEmail, renderSetupProgress, esc, type SetupProgressRow } from './template';
import { gapNames } from '@/lib/notifications/copy';
import { sendEmail, type SendResult } from './send';

/**
 * Every email this app sends, one function each.
 *
 * The import path is unchanged (`@/lib/email`) so no caller moved, but the contract
 * did, and it is the point of the whole exercise:
 *
 *   **Every function returns a `SendResult`. None of them throws, and none of them
 *   returns `void`.**
 *
 * They used to return `undefined` and swallow both "no API key" and Resend's
 * `{ error }` refusals, which is how an approval came to report a delivered link to
 * somebody who never got one. A caller can now only be wrong on purpose.
 *
 * Layout, colours and escaping live in ./template. Sending, logging and the honest
 * result live in ./send. This file is only *what each mail says* — which is where it
 * should be possible to make a change without thinking about infrastructure.
 */

export { isEmailConfigured, diagnoseEmail, readEmailConfig, SANDBOX_FROM_ADDRESS } from './config';
export type { EmailConfig, EmailHealth, EmailHealthLevel } from './config';
export { sendEmail } from './send';
export type { SendResult, SendStatus, OutboundEmail } from './send';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'madregot.club@gmail.com';

// ── Legacy Google/Garmin onboarding ──────────────────────────────────────────────

export async function notifyAdminNewUser(user: {
  name: string;
  email: string;
  onboardingStatus: string;
  hasGarmin?: boolean;
}): Promise<SendResult> {
  const authStatusMap: Record<string, string> = {
    garmin_authed: '✅ Google + Garmin connected',
    google_authed: '⚠️ Google only (skipped Garmin)',
  };
  const authStatus =
    authStatusMap[user.onboardingStatus] || (user.hasGarmin ? '✅ Google + Garmin' : '⚠️ Google only');

  return sendEmail({
    template: 'admin_new_user',
    to: ADMIN_EMAIL,
    subject: `🏃 New user waiting for approval: ${user.name}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'New user registration',
      rows: [['Name', user.name], ['Email', user.email], ['Auth', authStatus], ['Status', user.onboardingStatus]],
      cta: { label: 'Review & approve →', href: `${APP_URL}/dashboard/settings` },
    }),
  });
}

export async function notifyUserApproved(user: { name: string; email: string }): Promise<SendResult> {
  return sendEmail({
    template: 'user_approved',
    to: user.email,
    subject: '✅ Welcome to Madregot! You\'re approved',
    html: renderEmail({
      dir: 'ltr',
      title: `Welcome, ${user.name}! 🎉`,
      paragraphs: ['Your account has been approved. You can now access the full Madregot training platform.'],
      cta: { label: 'Open Madregot →', href: `${APP_URL}/dashboard` },
    }),
  });
}

export async function notifyAdminUserApproved(
  admin: { email: string },
  user: { name: string; email: string },
): Promise<SendResult> {
  return sendEmail({
    template: 'admin_user_approved',
    to: admin.email,
    subject: `✅ User approved: ${user.name}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'User approved',
      paragraphs: [`${user.name} (${user.email}) has been approved and notified.`],
    }),
  });
}

// ── Public /register form (migration 083, signup_requests) ───────────────────────
//
// Two mails, one each side of the approval:
//   notifyAdminNewSignupRequest  → the approvers, "someone registered"
//   notifyRegistrationApproved   → the applicant, WITH the link to finish
//
// The second is the whole point of the feature, and it is why this is not
// notifyUserApproved: that one links to /dashboard, which a person who has only ever
// given an email address cannot use. They have no name and no watch connected, so
// what they need is /join/{token} — the flow that asks for both.

export async function notifyAdminNewSignupRequest(req: {
  email: string;
  /**
   * The best name the system knows, already resolved by signupAlertName() — null
   * when it knows none. A Strava sign-in USUALLY gives a display name and always
   * gives a SYNTHETIC address (strava_1234@strava.madregot.local), so for that
   * person the name is the only identifying thing in the mail, which is why it
   * leads the subject line: "New registration waiting: strava_1234@…" identifies
   * nobody.
   */
  name?: string | null;
  groupName?: string | null;
}): Promise<SendResult> {
  // The synthetic address must never stand in for the person, in either place it
  // used to: the subject line fell back to it, and the Email row printed it as if
  // an approver could reply to it. It is not an address — nothing delivers there
  // and nobody has ever seen it. Say plainly that there isn't one instead.
  const address = req.email.toLowerCase().trim().endsWith('.local') ? null : req.email;
  const who = (req.name || '').trim() || address || 'a new Strava sign-in';
  return sendEmail({
    template: 'admin_new_signup_request',
    // The approver list, not just ADMIN_EMAIL: whoever is nearest their phone should
    // be able to let a new runner in.
    to: APPROVER_EMAILS,
    subject: `🏃 New registration waiting: ${who}`,
    html: renderEmail({
      dir: 'ltr',
      eyebrow: 'WAITING FOR APPROVAL',
      title: 'New registration',
      preheader: `${who} is waiting to be let into the club.`,
      rows: [
        ...(req.name ? ([['Name', req.name]] as Array<[string, string]>) : []),
        ['Email', address || 'none — they signed in with Strava'],
        ['Group', req.groupName || '—'],
      ],
      // The entry queue, which is now the only place anybody is let in. This used
      // to open the הרשמות list while every in-app path opened the entry queue, so
      // tapping the mail showed the approver a different screen than browsing did.
      cta: { label: 'Review & approve →', href: `${APP_URL}/dashboard/entry-queue?at=mine` },
      notes: ['They cannot enter the app until someone approves this.'],
    }),
  });
}

/**
 * The approval mail — Hebrew, because the recipient is a club member and the app is
 * Hebrew-first. This is the ONE email here that somebody reads before they have an
 * account, so it carries the link and nothing else to do.
 *
 * ⚠️ If this one fails, a person is approved, waiting, and has no idea. That is why
 * its result is read by both callers and surfaced on the registrations screen, and why
 * the queue also shows the link so it can be sent by hand.
 */
export async function notifyRegistrationApproved(user: {
  email: string;
  token: string;
  groupName?: string | null;
  athleteId?: string | null;
  signupRequestId?: string | null;
}): Promise<SendResult> {
  return sendEmail({
    template: 'registration_approved',
    to: user.email,
    subject: '✅ ההרשמה שלך למדרגות אושרה',
    athleteId: user.athleteId ?? null,
    signupRequestId: user.signupRequestId ?? null,
    html: renderEmail({
      eyebrow: 'ההרשמה אושרה',
      title: 'אושרת! 🎉',
      preheader: 'נשאר להשלים כמה פרטים ולחבר את Strava — דקה וזה נגמר.',
      paragraphs: [
        `ההרשמה שלך למדרגות אושרה${user.groupName ? ` — ${user.groupName}` : ''}. נשאר רק להשלים כמה פרטים ולהתחבר עם Strava, וזה הכל.`,
        'מי שהשעון שלו כבר מחובר אצלנו — נזהה את זה ונדלג על השלב.',
      ],
      cta: { label: 'להשלמת ההרשמה →', href: `${APP_URL}/join/${user.token}` },
      notes: ['הקישור אישי — אל תעבירו אותו לאף אחד.'],
    }),
  });
}

/**
 * "מישהו התחבר עם Strava ואומר שזה אתה" — the claim link (migration 098).
 *
 * The only mail in this file whose click MERGES two accounts, so it is written to
 * be read carefully rather than tapped reflexively: it names the account being
 * claimed, says what happens, and says what to do if it wasn't them. The recipient
 * is the one person who can tell, because it goes only to the address their own
 * roster row is keyed on — which is exactly what makes it proof.
 *
 * ⚠️ Never include the shell's Strava name in the SUBJECT. If this arrives at the
 * wrong mailbox (a mistyped address that happens to belong to another member), the
 * subject line is the part that leaks, and "someone called X is trying to reach
 * your account" is a name we were not asked to hand out.
 */
export async function notifyAthleteClaim(claim: {
  email: string;
  token: string;
  /** The Strava display name doing the asking — shown in the body, not the subject. */
  stravaName?: string | null;
  /** The name on the account being claimed, so the reader knows which one this is. */
  targetName?: string | null;
  athleteId?: string | null;
}): Promise<SendResult> {
  const who = (claim.stravaName || '').trim();
  return sendEmail({
    template: 'athlete_claim',
    to: claim.email,
    subject: '🔗 חיבור חשבון Strava למדרגות',
    athleteId: claim.athleteId ?? null,
    html: renderEmail({
      eyebrow: 'אישור חיבור חשבון',
      title: 'זה אתה?',
      // No name here either, for the same reason it stays out of the subject: the
      // preview line is shown on a locked screen.
      preheader: 'התחברות דרך Strava מבקשת להתחבר לחשבון שלך. אם זה לא אתה — אין מה לעשות.',
      paragraphs: [
        `התחברות חדשה דרך Strava${who ? ` בשם ${who}` : ''} מבקשת להתחבר לחשבון שלך במדרגות${
          claim.targetName ? ` (${claim.targetName})` : ''
        }.`,
        'אם זה אתה — הקישור למטה יחבר את השניים לחשבון אחד: כל האימונים, הדבוקה וההיסטוריה שלך יישארו איתך, ותוכל להיכנס דרך Strava מעכשיו.',
        'אם זה לא אתה — אין שום צורך לעשות דבר. בלי הקישור הזה שום דבר לא קורה, והוא נכבה מעצמו אחרי חצי שעה.',
      ],
      cta: { label: 'כן, זה אני — לחיבור →', href: `${APP_URL}/claim/${claim.token}` },
      notes: ['הקישור חד-פעמי, אישי, ותקף לחצי שעה. אל תעבירו אותו לאף אחד.'],
    }),
  });
}

// ── The entry nudge, by email ────────────────────────────────────────────────────

/**
 * "You were let in and never finished" — the same reminder as the push in
 * lib/notifications/copy.ts, for the members who have no subscription to push to.
 *
 * ⚠️ THIS MAIL EXISTS BECAUSE THE PUSH-ONLY VERSION REACHED THE WRONG HALF.
 * The nudge route was push-only on the stated grounds that "half the club signed
 * in through Strava and has no real address". Measured on 2026-09-13 that premise
 * was false: of the 23 active members, 9 had no push subscription and **all 9 had
 * a real address**, none had neither. So the one reminder the app has for somebody
 * who never arrived was undeliverable to exactly the people it was written for —
 * the worst case being a member 73 days past approval who had logged in once and
 * never seen the app open.
 *
 * That is also who it is for, in Ofer's words: the academy runners and the people
 * we sent an invitation to. Both gave us an address; a Strava-only sign-in never
 * did, and `realEmail()` at the call site is what keeps this off those rows.
 *
 * The CTA for somebody who never got in points at `/login`, NOT `/dashboard`, and
 * says to open it in the browser. This is the one channel that routes around the
 * iOS in-app-browser trap (migration 082): a link tapped in Gmail opens Safari,
 * whose storage the app can actually see, whereas the same person tapping "sign in
 * with Strava" inside another app's browser sheet logs in somewhere the app cannot
 * read. For that member the email is not a fallback — it is the only thing that
 * works.
 */
export async function notifyEntryNudge(user: {
  email: string;
  name?: string | null;
  /**
   * Open setup-task keys, or `['login']` for somebody who never landed in the app.
   * Resolved from the athlete row by the caller, never from a request body — this
   * mail names things about a person.
   */
  gaps: string[];
  athleteId?: string | null;
  /**
   * The whole scored checklist, when the caller has it — and the entry-queue route
   * does, because it computes computeSetupState() to derive `gaps` in the first place.
   * With it this mail shows the same marked list as the snapshot instead of naming
   * the missing items in a sentence; without it (or for somebody who never got in,
   * where there is nothing to score yet) it falls back to the sentence.
   */
  setup?: { doneCount: number; total: number; rows: SetupProgressRow[] };
}): Promise<SendResult> {
  const who = (user.name || '').trim();
  const hey = who ? `${who}, ` : '';
  const neverGotIn = user.gaps.includes('login');
  // Hebrew only, like every other member-facing mail here: the club reads Hebrew and
  // the notification-language setting is a push setting, not an inbox one.
  const missing = gapNames('he', user.gaps);

  return sendEmail({
    template: 'entry_nudge',
    to: user.email,
    athleteId: user.athleteId ?? null,
    subject: neverGotIn ? '👋 האפליקציה של מדרגות מחכה לך' : '⏳ נשאר לסדר כמה דברים באפליקציה',
    html: renderEmail({
      eyebrow: neverGotIn ? 'החשבון שלך מחכה' : 'כמעט שם',
      title: neverGotIn ? `${hey}האפליקציה מחכה לך 👋` : `${hey}כמעט סיימת`,
      preheader: neverGotIn
        ? 'החשבון מאושר, אבל האפליקציה עוד לא נפתחה אצלך. הקישור כאן פותר את זה.'
        : `נשאר ${missing.length > 1 ? 'כמה דברים קטנים' : 'דבר קטן אחד'} בפרופיל.`,
      paragraphs: neverGotIn
        ? [
            'החשבון שלך במדרגות מאושר וממתין — אבל עוד לא נכנסת לאפליקציה.',
            'הסיבה הנפוצה: התחברות מתוך אפליקציה אחרת (אינסטגרם, ווטסאפ) נפתחת בדפדפן פנימי שהאפליקציה לא רואה, ואז ההתחברות מצליחה והאפליקציה נשארת סגורה. הקישור למטה נפתח בדפדפן הרגיל של הטלפון, וזה פותר את זה.',
          ]
        : [
            `נכנסת לאפליקציה, ונשאר עוד ${missing.length > 1 ? 'כמה דברים קטנים' : 'דבר קטן אחד'} כדי שהיא תעבוד בשבילך במלואה.`,
            // The list itself is drawn below when the caller passed the state. Only
            // when it didn't does it have to be said in a sentence.
            ...(user.setup
              ? []
              : [missing.length ? `חסר: ${missing.join(', ')}.` : 'נשאר להשלים את ההגדרה בפרופיל.']),
            'דקה בפרופיל וסיימנו.',
          ],
      bodyHtml: !neverGotIn && user.setup ? renderSetupProgress(user.setup) : undefined,
      cta: neverGotIn
        ? { label: 'להתחברות לאפליקציה →', href: `${APP_URL}/login` }
        : { label: 'להשלמת הפרופיל →', href: `${APP_URL}/dashboard/profile` },
      notes: neverGotIn
        ? ['אם זה לא נפתח — פתחו את הקישור ישירות ב-Safari או ב-Chrome.']
        : ['אם כבר סידרתם את זה — אין צורך לעשות כלום.'],
    }),
  });
}

// ── The 15-minute setup snapshot ─────────────────────────────────────────────────

/**
 * "A quarter of an hour in — here is what's set and what isn't."
 *
 * The same snapshot as the push in lib/notifications/copy.ts, for the members with
 * no subscription to push to. One channel each, decided by snapshotChannel(), and
 * neither is sent to somebody who finished.
 *
 * Every row is MARKED — a green tick or a red cross — because that is the whole
 * request this mail answers: not "you have things left" but "these two are done,
 * these three are not, and here is why each one matters". The marks are text
 * glyphs on coloured discs rather than images: an inline `<img>` in a mail is a
 * tracking pixel to most clients and gets stripped, which would leave a checklist
 * with no checks in it.
 */
export async function notifySetupSnapshot(user: {
  email: string;
  name?: string | null;
  athleteId?: string | null;
  doneCount: number;
  total: number;
  /** Already ordered (done first) and already localised — see snapshotRowCopy. */
  rows: Array<{ name: string; hint: string; done: boolean }>;
}): Promise<SendResult> {
  const who = (user.name || '').trim();
  const hey = who ? `${who}, ` : '';
  const left = user.total - user.doneCount;

  return sendEmail({
    template: 'setup_snapshot',
    to: user.email,
    athleteId: user.athleteId ?? null,
    subject: `⏳ ${user.doneCount} מתוך ${user.total} — מה נשאר לך באפליקציה`,
    html: renderEmail({
      eyebrow: 'רבע שעה בפנים',
      title: `${hey}ככה זה נראה אצלך עכשיו`,
      preheader: `${user.doneCount} מתוך ${user.total} מסודרים${left ? `, נשאר ${left}` : ''} — הכל מסומן כאן בפנים.`,
      paragraphs: [
        'נכנסת לאפליקציה לפני רבע שעה — הנה מה שכבר מסודר ומה שלא, כדי שלא תישאר עם חצי אפליקציה.',
      ],
      bodyHtml: renderSetupProgress(user),
      cta: { label: 'להשלמת מה שנשאר →', href: `${APP_URL}/dashboard/profile` },
      notes: ['נשלח פעם אחת בלבד, ורק אם משהו חסר. אם כבר סידרתם הכל — לא יישלח כלום.'],
    }),
  });
}

// ── Academy ──────────────────────────────────────────────────────────────────────

export async function notifyAdminNewAcademyRegistration(user: {
  name: string;
  email: string;
  phone?: string;
  /** The address already belongs to a roster row, which the form left untouched. */
  existingMember?: boolean;
}): Promise<SendResult> {
  return sendEmail({
    template: 'admin_new_academy_registration',
    to: ADMIN_EMAIL,
    subject: `🎓 New academy registration: ${user.name}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'New academy registration',
      rows: [
        ['Name', user.name],
        ['Email', user.email],
        ['Phone', user.phone || '—'],
        ...(user.existingMember
          ? [['Existing member', 'Yes — this address is already on the roster, so the account was not changed. Link it from the academy funnel if this is them.'] as [string, string]]
          : []),
      ],
      cta: { label: 'Review & approve →', href: `${APP_URL}/dashboard/settings` },
    }),
  });
}

export async function notifyAcademyApproved(user: {
  name: string;
  email: string;
  token: string;
}): Promise<SendResult> {
  return sendEmail({
    template: 'academy_approved',
    to: user.email,
    subject: '✅ You\'re in the Madregot Academy — connect your watch',
    html: renderEmail({
      dir: 'ltr',
      title: `Welcome to the Academy, ${user.name}! 🎉`,
      paragraphs: [
        'Your registration was approved. One last step: connect your Garmin watch so your coach can send you workouts and track your progress.',
      ],
      cta: { label: 'Connect Garmin →', href: `${APP_URL}/join/academy/${user.token}` },
    }),
  });
}

// ── Academy weekly report ────────────────────────────────────────────────────────

export interface AcademyReportRow {
  name: string;
  completedCount: number;
  plannedCount: number;
  completionRate: number; // 0..1
  avgScore: number; // 0..1
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function rateColor(rate: number): string {
  if (rate >= 0.8) return '#16a34a';
  if (rate >= 0.5) return '#FF5315';
  return '#D74E4E';
}

export async function sendAcademyWeeklyReport(params: {
  weekStart: string;
  weekEnd: string;
  rows: AcademyReportRow[];
  to?: string;
}): Promise<SendResult> {
  const { weekStart, weekEnd, rows } = params;
  if (rows.length === 0) {
    return { ok: false, status: 'skipped', code: 'no-rows', reason: 'No athletes to report on', logId: null };
  }

  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const totalPlanned = rows.reduce((a, r) => a + r.plannedCount, 0);
  const totalDone = rows.reduce((a, r) => a + r.completedCount, 0);
  const overall = totalPlanned ? totalDone / totalPlanned : 0;

  // Worst first: the point of the digest is who needs a phone call.
  const tableRows = rows
    .slice()
    .sort((a, b) => a.completionRate - b.completionRate)
    .map(r => `
      <tr>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; font-weight: 600; color: #1D1E26;">${esc(r.name)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; text-align: center; color: #2D2E38;">${r.completedCount}/${r.plannedCount}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; text-align: center; font-weight: 700; color: ${rateColor(r.completionRate)};">${pct(r.completionRate)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #DFDFDF; text-align: center; color: #656565;">${pct(r.avgScore)}</td>
      </tr>`)
    .join('');

  return sendEmail({
    template: 'academy_weekly_report',
    to: params.to || ADMIN_EMAIL,
    subject: `🎓 Academy weekly report — ${fmt(weekStart)}–${fmt(weekEnd)}`,
    html: renderEmail({
      dir: 'ltr',
      title: 'Academy weekly report',
      paragraphs: [`${fmt(weekStart)} – ${fmt(weekEnd)}`],
      bodyHtml: `
        <div style="background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 16px 0;">
          <span style="font-size: 28px; font-weight: 800; color: ${rateColor(overall)};">${pct(overall)}</span>
          <span style="color: #2D2E38;"> overall sessions completed (${totalDone}/${totalPlanned}) across ${rows.length} athlete${rows.length !== 1 ? 's' : ''}</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="text-align: left; color: #94a3b8; font-size: 12px;">
              <th style="padding: 8px;">Athlete</th>
              <th style="padding: 8px; text-align: center;">Done</th>
              <th style="padding: 8px; text-align: center;">Completion</th>
              <th style="padding: 8px; text-align: center;">On-plan</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>`,
      cta: { label: 'Open Academy →', href: `${APP_URL}/dashboard/academy` },
      notes: ['"On-plan" = average share of distance/time/pace targets hit on completed sessions.'],
    }),
  });
}
