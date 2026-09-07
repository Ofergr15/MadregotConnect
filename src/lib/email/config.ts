/**
 * What state is outbound mail actually in — asked as a question with an answer,
 * rather than assumed.
 *
 * ⚠️ This file exists because of the exact hole we fell into on 2026-09-06.
 * Production had `RESEND_API_KEY` and no `RESEND_FROM_EMAIL`, so `FROM` silently fell
 * back to Resend's shared sandbox address. Everything looked configured. Every send
 * to a club member was refused. Nothing said so, because "is mail configured" was a
 * single boolean over the presence of a key — and it answered `true`.
 *
 * A boolean was the wrong shape. There are three states, they need three different
 * actions, and one of them ("mail works, but only to ourselves") is invisible unless
 * something goes looking. `diagnoseEmail()` returns which one we are in and what to
 * do about it, and the UI puts that on the screen.
 */

/**
 * Resend's shared onboarding sender. It works without verifying a domain, which is
 * why it makes such a tempting default — and it may only deliver to the address that
 * owns the Resend account. Every other recipient is rejected outright.
 */
export const SANDBOX_FROM_ADDRESS = 'onboarding@resend.dev';

const DEFAULT_FROM = `Madregot <${SANDBOX_FROM_ADDRESS}>`;

export interface EmailConfig {
  hasKey: boolean;
  /** The full `Name <addr>` header value that will be used. */
  from: string;
  /** Just the address part, lowercased. */
  fromAddress: string;
  /** True when we are on Resend's shared sender and can only mail ourselves. */
  isSandboxSender: boolean;
}

/** Read per call rather than at module load: env differs per deployment, and the
 *  tests set it per case. */
export function readEmailConfig(): EmailConfig {
  const from = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  // `Madregot <x@y.com>` and a bare `x@y.com` are both valid in this env var.
  const fromAddress = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();
  return {
    hasKey: !!process.env.RESEND_API_KEY,
    from,
    fromAddress,
    isSandboxSender: fromAddress === SANDBOX_FROM_ADDRESS,
  };
}

/**
 * Whether a send will be attempted at all.
 *
 * Its own answer, separate from health: "no key" is the normal, correct state of a
 * preview deployment and is not a fault to report. It is only a fault in production.
 */
export function isEmailConfigured(): boolean {
  return readEmailConfig().hasKey;
}

export type EmailHealthLevel =
  /** Mail goes out to anyone. */
  | 'ok'
  /** Mail is attempted and will be refused for anyone but the account owner. */
  | 'blocked'
  /** No mail is attempted at all. */
  | 'off';

export interface EmailHealth {
  level: EmailHealthLevel;
  code: 'ok' | 'no-key' | 'sandbox-sender';
  from: string;
  /** Hebrew, for the banner: what is wrong. */
  title: string;
  /** Hebrew: what it means for the people this app mails. */
  detail: string;
  /** Hebrew: the fix, concrete enough to act on without looking anything up. */
  fix: string;
}

export function diagnoseEmail(): EmailHealth {
  const cfg = readEmailConfig();

  if (!cfg.hasKey) {
    return {
      level: 'off',
      code: 'no-key',
      from: cfg.from,
      title: 'שליחת מיילים כבויה בסביבה הזו',
      detail: 'אף מייל לא יוצא — לא לנרשמים ולא למאשרים. אישור הרשמה עצמו יעבוד, אבל אף אחד לא יקבל את הקישור.',
      fix: 'להגדיר RESEND_API_KEY במשתני הסביבה.',
    };
  }

  if (cfg.isSandboxSender) {
    return {
      level: 'blocked',
      code: 'sandbox-sender',
      from: cfg.from,
      title: 'כתובת השולח היא כתובת הבדיקות של Resend',
      detail:
        `המיילים יוצאים מ-${SANDBOX_FROM_ADDRESS}, וכתובת כזו מותרת לשליחה רק לכתובת של בעל החשבון ב-Resend. ` +
        'זה בדיוק ההסבר לזה שמיילים אלינו הגיעו ומיילים לנרשמים לא: כל שליחה לכתובת אחרת נדחית.',
      fix: 'לאמת דומיין ב-Resend (למשל madregot.app), ואז להגדיר RESEND_FROM_EMAIL — לדוגמה: Madregot <noreply@madregot.app>.',
    };
  }

  return {
    level: 'ok',
    code: 'ok',
    from: cfg.from,
    title: 'שליחת מיילים מוגדרת',
    detail: `המיילים יוצאים מ-${cfg.from}.`,
    fix: '',
  };
}
