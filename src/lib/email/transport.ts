import { Resend } from 'resend';
import { isOutboundTimeoutError, withTimeout } from '@/lib/http/timeout';
import { logRetry, withRetry, type Outcome } from '@/lib/http/retry';

/**
 * Resend answers errors in the body, not by throwing. Only a rate limit and Resend's own
 * failures are worth repeating; a validation error or a spent daily quota is not.
 */
export function classifyResendResult(r: unknown): Outcome {
  const name = (r as { error?: { name?: string } | null })?.error?.name;
  if (!(r as { error?: unknown })?.error) return { kind: 'ok' };
  if (name === 'rate_limit_exceeded') return { kind: 'status', status: 429 };
  if (name === 'internal_server_error' || name === 'application_error') return { kind: 'status', status: 500 };
  return { kind: 'status', status: 400 };
}
import { DEV_SUPABASE_REF, supabaseRef } from '@/lib/dev-api-allowlist';

type Env = Record<string, string | undefined>;

/**
 * Where an email physically goes — the pluggable half of sendEmail (BUILD-BRIEF gap 1).
 *
 * `EMAIL_TRANSPORT` picks it:
 *   resend   (default) Resend, needs RESEND_API_KEY + a verified RESEND_FROM_EMAIL.
 *   dev-log  prints subject, recipients and the text of the mail to the server log
 *            instead of sending. Refused outside dev (see below) and falls back to
 *            resend, so a stray env var on production can never swallow real mail.
 *
 * Adding a provider = one more `EmailTransport` here; send.ts, email_log and every
 * caller stay as they are.
 */
export interface TransportResult {
  ok: boolean;
  id?: string | null;
  code?: string;
  reason?: string;
}

export interface EmailTransport {
  name: 'resend' | 'dev-log';
  send(m: { from: string; to: string[]; subject: string; html: string; replyTo?: string | null }): Promise<TransportResult>;
}

/** dev-log is only ever honoured on the dev project, and never on a production deployment. */
export function devLogAllowed(env: Env = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false;
  if (env.VERCEL) return supabaseRef(env) === DEV_SUPABASE_REF;
  return env.NODE_ENV !== 'production'; // local `next dev`
}

export function transportName(env: Env = process.env): EmailTransport['name'] {
  return env.EMAIL_TRANSPORT === 'dev-log' && devLogAllowed(env) ? 'dev-log' : 'resend';
}

const resend: EmailTransport = {
  name: 'resend',
  async send(m) {
    let sent;
    try {
      // One idempotency key per message, reused by every retry: Resend sends it once
      // however many times the request arrives, so even a timeout is safe to repeat.
      const idempotencyKey = crypto.randomUUID();
      const client = new Resend(process.env.RESEND_API_KEY!);
      sent = await withRetry('resend', () => withTimeout('resend', client.emails.send({
        from: m.from,
        to: m.to,
        subject: m.subject,
        html: m.html,
        ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      }, { idempotencyKey })), { idempotent: true, classify: classifyResendResult, onRetry: logRetry });
    } catch (e) {
      // A timeout is reported like a refusal so the caller's not-sent bookkeeping runs.
      if (isOutboundTimeoutError(e)) return { ok: false, code: e.code, reason: e.message };
      throw e;
    }
    const { data, error } = sent;
    if (error) return { ok: false, code: error.name || 'resend_error', reason: error.message || 'Resend refused the send' };
    return { ok: true, id: data?.id ?? null };
  },
};

const devLog: EmailTransport = {
  name: 'dev-log',
  async send(m) {
    const text = m.html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`[email:dev-log] to=${m.to.join(',')} subject=${m.subject}\n${text.slice(0, 1200)}`);
    return { ok: true, id: null };
  },
};

export function activeTransport(env: Env = process.env): EmailTransport {
  return transportName(env) === 'dev-log' ? devLog : resend;
}
