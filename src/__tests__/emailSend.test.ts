import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * The one send path — src/lib/email/send.ts.
 *
 * ⚠️ THE REGRESSION THESE EXIST FOR, in one line: `resend.emails.send()` RESOLVES with
 * `{ data: null, error }` when the API refuses. It does not throw. Every caller in this
 * app decided success by "nothing threw", so on 2026-09-06 an approval reported a link
 * delivered to somebody who was never written to, and the club's launch would have gone
 * out to nobody.
 *
 * The first test below is the whole point of the file. If it ever goes green while
 * `sendEmail` stops reading `error`, the bug is back.
 */

/** What the fake Resend will resolve with. Never rejects, exactly like the real one. */
let resendResponse: { data: { id: string } | null; error: { name: string; message: string } | null };
/** Or, when set, what it throws — the network-failure path, which is different. */
let resendThrows: Error | null;
const sendSpy = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: unknown) => {
        sendSpy(payload);
        if (resendThrows) throw resendThrows;
        return resendResponse;
      },
    };
  },
}));

/** Rows the fake email_log insert received. */
let logged: Array<Record<string, unknown>>;
/** Forced failure from the log insert, to prove logging can't break a send. */
let logError: { code: string; message: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        logged.push(row);
        return {
          select: () => ({
            single: () => Promise.resolve(
              logError ? { data: null, error: logError } : { data: { id: 'log-1' }, error: null },
            ),
          }),
        };
      },
    }),
  }),
}));

const { sendEmail } = await import('@/lib/email/send');
const { diagnoseEmail, readEmailConfig, SANDBOX_FROM_ADDRESS } = await import('@/lib/email/config');

const ORIGINAL_ENV = { ...process.env };

const msg = { template: 'test_mail', to: 'dana@gmail.com', subject: 'נושא', html: '<p>hi</p>' };

beforeEach(() => {
  logged = [];
  logError = null;
  resendThrows = null;
  resendResponse = { data: { id: 'resend-abc' }, error: null };
  sendSpy.mockClear();
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.RESEND_FROM_EMAIL = 'Madregot <noreply@madregot.app>';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('sendEmail — a resolved promise is not a sent email', () => {
  it('reports FAILURE when Resend resolves with an error', async () => {
    // ⚠️ THE BUG. Nothing throws here. The old code called this a success.
    resendResponse = {
      data: null,
      error: { name: 'validation_error', message: 'You can only send testing emails to your own email address' },
    };
    const result = await sendEmail(msg);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe('refused');
    // Resend's own words travel out — "send failed" would not name the cause.
    expect(result.code).toBe('validation_error');
    expect(result.reason).toMatch(/own email address/);
  });

  it('reports success only when Resend actually accepted it', async () => {
    const result = await sendEmail(msg);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.providerId).toBe('resend-abc');
  });

  it('never throws — a mail is always secondary to what triggered it', async () => {
    // An approval is already committed by the time we get here; a Resend outage must
    // not 500 the request or roll it back.
    resendThrows = new Error('ECONNRESET');
    const result = await sendEmail(msg);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('ECONNRESET');
  });

  it('does not attempt a send with no API key, and says which state that is', async () => {
    delete process.env.RESEND_API_KEY;
    const result = await sendEmail(msg);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // 'skipped', NOT 'refused': a preview deployment with no key is not a fault, and
    // the two need different words on the screen.
    expect(result.status).toBe('skipped');
    expect(result.code).toBe('email-not-configured');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('refuses to call the API with no recipient', async () => {
    const result = await sendEmail({ ...msg, to: '  ' });
    expect(result.ok).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('sendEmail — the audit trail', () => {
  it('records a sent mail with the provider id', async () => {
    await sendEmail(msg);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      template: 'test_mail',
      recipients: ['dana@gmail.com'],
      status: 'sent',
      provider_id: 'resend-abc',
      from_address: 'Madregot <noreply@madregot.app>',
    });
  });

  it('records a refusal WITH the reason — this is what was missing', async () => {
    // The HTTP response used to be the only place a refusal existed, and it vanished
    // with the request. An hour later "did they get their link" was unanswerable.
    resendResponse = { data: null, error: { name: 'forbidden', message: 'domain not verified' } };
    await sendEmail(msg);
    expect(logged[0]).toMatchObject({
      status: 'refused',
      error_code: 'forbidden',
      error_message: 'domain not verified',
    });
  });

  it('never records "delivered" — only the webhook may say that', async () => {
    // Resend accepting a message is not the receiving server accepting it. Conflating
    // them is how a bounced address looks fine on every screen.
    await sendEmail(msg);
    expect(logged[0].status).toBe('sent');
  });

  it('still sends when the log table does not exist yet', async () => {
    // Migrations here are pasted into the SQL editor by hand, so "096 not applied" is a
    // real state. Logging must never be able to block a send.
    logError = { code: '42P01', message: 'relation "email_log" does not exist' };
    const result = await sendEmail(msg);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.logId).toBeNull();
  });

  it('links the row to the person it is about', async () => {
    await sendEmail({ ...msg, athleteId: 'athlete-1', signupRequestId: 'req-1' });
    expect(logged[0]).toMatchObject({ athlete_id: 'athlete-1', signup_request_id: 'req-1' });
  });

  it('splits a comma-joined recipient list', async () => {
    // The academy report route builds its list with join(', ') — a nodemailer habit.
    // Resend does not parse that, so a second recipient used to make one bad address.
    await sendEmail({ ...msg, to: 'a@x.com, b@y.com' });
    expect(logged[0].recipients).toEqual(['a@x.com', 'b@y.com']);
    expect(sendSpy.mock.calls[0][0]).toMatchObject({ to: ['a@x.com', 'b@y.com'] });
  });
});

describe('diagnoseEmail — the state that was invisible', () => {
  it('calls out the sandbox sender when RESEND_FROM_EMAIL is unset', async () => {
    // ⚠️ This was production. A key was present, so every "is mail configured" check
    // said yes, while the sender could only deliver to the Resend account owner.
    delete process.env.RESEND_FROM_EMAIL;
    const cfg = readEmailConfig();
    expect(cfg.hasKey).toBe(true);
    expect(cfg.isSandboxSender).toBe(true);
    expect(cfg.fromAddress).toBe(SANDBOX_FROM_ADDRESS);

    const health = diagnoseEmail();
    expect(health.level).toBe('blocked');
    expect(health.code).toBe('sandbox-sender');
    // The fix has to be in the message. A banner that says "misconfigured" without
    // saying what to set is a banner that gets ignored.
    expect(health.fix).toMatch(/RESEND_FROM_EMAIL/);
  });

  it('separates "no key" from "wrong sender" — different faults, different fixes', async () => {
    delete process.env.RESEND_API_KEY;
    const health = diagnoseEmail();
    expect(health.level).toBe('off');
    expect(health.code).toBe('no-key');
  });

  it('is quiet once a verified sender is set', async () => {
    const health = diagnoseEmail();
    expect(health.level).toBe('ok');
    expect(health.code).toBe('ok');
  });

  it('reads the address out of either env var shape', async () => {
    process.env.RESEND_FROM_EMAIL = 'noreply@madregot.app';
    expect(readEmailConfig().fromAddress).toBe('noreply@madregot.app');
    process.env.RESEND_FROM_EMAIL = 'Madregot Club <NoReply@Madregot.App>';
    expect(readEmailConfig().fromAddress).toBe('noreply@madregot.app');
  });
});
