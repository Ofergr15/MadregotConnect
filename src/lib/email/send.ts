import { Resend } from 'resend';
import { createServerClient } from '@/lib/supabase/server';
import { readEmailConfig } from './config';

/**
 * THE ONE PLACE AN EMAIL LEAVES THIS APP.
 *
 * ── THE BUG THIS REPLACES ──────────────────────────────────────────────────────────
 * `resend.emails.send()` does NOT throw when the API refuses. It RESOLVES with
 * `{ data: null, error }`. Eight call sites awaited it, none read `error`, and each
 * one decided success by "nothing threw". So on 2026-09-06 an approval reported
 * `emailed: true` about a person who was never written to, and the club's whole
 * launch would have gone out to nobody.
 *
 * Three rules follow from that, and they are the entire design of this file:
 *
 *   1. **A result, not an exception.** Every send returns a discriminated
 *      `SendResult`. There is no way to call this and accidentally treat a refusal as
 *      success, because there is no path that returns nothing.
 *   2. **It never throws.** A mail is always secondary to the thing that triggered
 *      it — an approval is already committed by the time we get here, and a Resend
 *      outage must not roll it back or 500 the request. Callers that care read `ok`.
 *   3. **Every attempt is recorded.** `email_log` (migration 096) outlives the HTTP
 *      response, so "did that person ever get their link" stays answerable, and
 *      Resend's webhook can come back later and say it bounced.
 *
 * ⚠️ Logging must never be able to break a send. Every write here is wrapped and
 * swallowed — including the 42P01 you get before migration 096 is pasted into the SQL
 * editor, since migrations in this repo are applied by hand.
 */

/** What our own call did. See migration 096 for the provider-observed states. */
export type SendStatus = 'skipped' | 'refused' | 'failed' | 'sent';

export type SendResult =
  | { ok: true; status: 'sent'; providerId: string | null; logId: string | null }
  | {
      ok: false;
      status: 'skipped' | 'refused' | 'failed';
      /** Machine code: 'email-not-configured', or Resend's own error name. */
      code: string;
      /** Human-readable, and safe to show staff. Never a secret. */
      reason: string;
      logId: string | null;
    };

export interface OutboundEmail {
  /** Stable key for grouping and counting — not the subject, which is prose. */
  template: string;
  to: string | string[];
  subject: string;
  html: string;
  /** Optional back-references so a person's mail history is one query. */
  athleteId?: string | null;
  signupRequestId?: string | null;
}

/**
 * Normalise the address list.
 *
 * The comma split is a real fix, not defensiveness: the academy report route builds
 * its recipients with `recipients.join(', ')` (a nodemailer habit — that library
 * parses a comma list, Resend does not), so a second configured recipient produced
 * one malformed address and a refused send. Splitting here means every caller can
 * pass whichever shape is natural.
 */
function recipients(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to])
    .flatMap(a => String(a).split(','))
    .map(a => a.trim())
    .filter(Boolean);
}

/** Insert the audit row. Returns its id, or null if it could not be written —
 *  which is never treated as a failure of the send. */
async function writeLog(row: Record<string, unknown>): Promise<string | null> {
  try {
    const { data, error } = await createServerClient()
      .from('email_log')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      // 42P01 = table missing, i.e. migration 096 has not been applied yet. Expected,
      // and not worth shouting about; anything else is a real problem worth a log line.
      if (error.code !== '42P01') console.error('email_log insert failed:', error.message);
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (err) {
    console.error('email_log insert threw:', err);
    return null;
  }
}

export async function sendEmail(msg: OutboundEmail): Promise<SendResult> {
  const cfg = readEmailConfig();
  const to = recipients(msg.to);

  const base = {
    template: msg.template,
    recipients: to,
    subject: msg.subject,
    from_address: cfg.from,
    athlete_id: msg.athleteId ?? null,
    signup_request_id: msg.signupRequestId ?? null,
  };

  if (!to.length) {
    // Nobody to write to. A bug in the caller, not an infrastructure failure, so it
    // is loud in the log and quiet to the user.
    console.error(`sendEmail(${msg.template}) called with no recipients`);
    return { ok: false, status: 'failed', code: 'no-recipients', reason: 'No recipient address', logId: null };
  }

  // Preview deployments legitimately have no key. Recorded rather than silently
  // dropped, so a missing mail in staging is still explainable afterwards.
  if (!cfg.hasKey) {
    const logId = await writeLog({ ...base, status: 'skipped', error_code: 'email-not-configured' });
    return {
      ok: false,
      status: 'skipped',
      code: 'email-not-configured',
      reason: 'שליחת מיילים לא מוגדרת בסביבה הזו (חסר RESEND_API_KEY).',
      logId,
    };
  }

  try {
    const { data, error } = await new Resend(process.env.RESEND_API_KEY!).emails.send({
      from: cfg.from,
      to,
      subject: msg.subject,
      html: msg.html,
    });

    // ⚠️ THE LINE THE WHOLE FILE IS ABOUT. A resolved promise is not a sent email.
    if (error) {
      const code = error.name || 'resend_error';
      const reason = error.message || 'Resend refused the send';
      const logId = await writeLog({ ...base, status: 'refused', error_code: code, error_message: reason });
      console.error(`Email refused (${msg.template}) → ${to.join(', ')}: ${code}: ${reason}`);
      return { ok: false, status: 'refused', code, reason, logId };
    }

    const providerId = data?.id ?? null;
    // 'sent' means Resend accepted it — deliberately NOT 'delivered'. Only the webhook
    // may promote it, because the receiving server can still reject it after this.
    const logId = await writeLog({ ...base, status: 'sent', provider_id: providerId });
    return { ok: true, status: 'sent', providerId, logId };
  } catch (err) {
    // Network, timeout, a bad key shape — anything that never reached the API.
    const reason = err instanceof Error ? err.message : 'Send failed';
    const logId = await writeLog({ ...base, status: 'failed', error_code: 'exception', error_message: reason });
    console.error(`Email threw (${msg.template}) → ${to.join(', ')}:`, err);
    return { ok: false, status: 'failed', code: 'exception', reason, logId };
  }
}
