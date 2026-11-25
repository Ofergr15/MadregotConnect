import { Resend } from 'resend';
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
  send(m: { from: string; to: string[]; subject: string; html: string; replyTo?: string | null; headers?: Record<string, string> }): Promise<TransportResult>;
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
    const { data, error } = await new Resend(process.env.RESEND_API_KEY!).emails.send({
      from: m.from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      ...(m.headers ? { headers: m.headers } : {}),
    });
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
