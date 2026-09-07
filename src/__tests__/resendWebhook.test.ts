import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

/**
 * POST /api/webhooks/resend — the only public, unauthenticated write path in the app.
 *
 * It exists because `status='sent'` only means Resend ACCEPTED the message; the
 * receiving server can still bounce it minutes later, and for a club whose approval
 * mail is the only way in, a bounced address must not look identical to a delivered one.
 *
 * ⚠️ Webhooks carry no session, so the signature IS the authentication. These tests are
 * the boundary: a forged body, an unsigned body, a replayed body and a missing secret
 * all have to be refused, or anyone who finds the URL has a write primitive.
 */

const updates: Array<{ patch: Record<string, unknown>; providerId: unknown }> = [];
let updateError: { code: string; message: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, providerId: unknown) => {
          updates.push({ patch, providerId });
          return Promise.resolve({ error: updateError });
        },
      }),
    }),
  }),
}));

const { POST } = await import('@/app/api/webhooks/resend/route');

const SECRET = `whsec_${Buffer.from('a-test-signing-key').toString('base64')}`;
const ORIGINAL_ENV = { ...process.env };

/** Sign exactly the way Svix does, so a valid request here is a valid request there. */
function sign(body: string, id: string, timestamp: string, secret = SECRET) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

function post(
  payload: unknown,
  over: { signature?: string; timestamp?: string; id?: string; omit?: boolean } = {},
) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const id = over.id ?? 'msg_1';
  const timestamp = over.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {};
  if (!over.omit) {
    headers['svix-id'] = id;
    headers['svix-timestamp'] = timestamp;
    headers['svix-signature'] = over.signature ?? `v1,${sign(body, id, timestamp)}`;
  }
  return POST(new Request('https://www.madregot.app/api/webhooks/resend', { method: 'POST', body, headers }));
}

const delivered = { type: 'email.delivered', data: { email_id: 'resend-abc' } };

beforeEach(() => {
  updates.length = 0;
  updateError = null;
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('resend webhook — the signature is the authentication', () => {
  it('accepts a correctly signed event', async () => {
    const res = await post(delivered);
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.status).toBe('delivered');
    expect(updates[0].providerId).toBe('resend-abc');
  });

  it('refuses a forged signature', async () => {
    const res = await post(delivered, { signature: 'v1,ZmFrZQ==' });
    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it('refuses a body signed with a different secret', async () => {
    const body = JSON.stringify(delivered);
    const ts = String(Math.floor(Date.now() / 1000));
    const other = `whsec_${Buffer.from('someone-elses-key').toString('base64')}`;
    const res = await post(body, { signature: `v1,${sign(body, 'msg_1', ts, other)}`, timestamp: ts });
    expect(res.status).toBe(401);
  });

  it('refuses a body that was altered after signing', async () => {
    // The signature covers the raw bytes, so swapping delivered→bounced invalidates it.
    const signedBody = JSON.stringify(delivered);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,${sign(signedBody, 'msg_1', ts)}`;
    const res = await post(JSON.stringify({ type: 'email.bounced', data: { email_id: 'resend-abc' } }), {
      signature: sig,
      timestamp: ts,
    });
    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it('refuses an unsigned body outright', async () => {
    expect((await post(delivered, { omit: true })).status).toBe(401);
  });

  it('refuses a replay from outside the 300s window', async () => {
    // Without this a captured payload stays valid forever.
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect((await post(delivered, { timestamp: old })).status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it('accepts a signature list, as sent during a secret rotation', async () => {
    const body = JSON.stringify(delivered);
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await post(body, { signature: `v1,d3Jvbmc= v1,${sign(body, 'msg_1', ts)}`, timestamp: ts });
    expect(res.status).toBe(200);
  });

  it('accepts NOTHING when no secret is configured', async () => {
    // ⚠️ The fail-closed rule. Trusting an unsigned body from the open internet because
    // an env var is missing would hand out a write primitive; 503 also makes the missing
    // config visible in Resend's own dashboard instead of looking healthy.
    delete process.env.RESEND_WEBHOOK_SECRET;
    const res = await post(delivered);
    expect(res.status).toBe(503);
    expect(updates).toHaveLength(0);
  });
});

describe('resend webhook — what it records', () => {
  const send = (type: string) => post({ type, data: { email_id: 'resend-abc' } });

  it('maps the events that change what we believe', async () => {
    for (const [type, status] of [
      ['email.delivered', 'delivered'],
      ['email.bounced', 'bounced'],
      ['email.complained', 'complained'],
      ['email.delivery_delayed', 'delayed'],
    ]) {
      updates.length = 0;
      await send(type);
      expect(updates[0]?.patch.status).toBe(status);
    }
  });

  it('ignores email.sent so it cannot demote a delivered row', async () => {
    // We wrote that row ourselves at send time. Letting the event back in would
    // overwrite a later 'delivered' with 'sent' whenever Resend delivers them out of
    // order — turning a known-good mail back into an unknown.
    const res = await send('email.sent');
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it('200s an event it does not care about', async () => {
    // A non-2xx makes Resend retry the same event forever.
    const res = await send('contact.created');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: 'contact.created' });
  });

  it('200s an event with no email id rather than updating every row', async () => {
    const res = await post({ type: 'email.bounced', data: {} });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it('400s a signed body that is not JSON', async () => {
    expect((await post('not json')).status).toBe(400);
  });

  it('tolerates the log table not existing yet', async () => {
    // Migration 096 is applied by hand. Until then there is nothing to promote, and a
    // retry storm over it would be pointless.
    updateError = { code: '42P01', message: 'relation "email_log" does not exist' };
    expect((await post(delivered)).status).toBe(200);
  });

  it('500s a real DB failure so Resend retries', async () => {
    // A bounce we failed to record is worth another attempt — it is the only signal
    // that a member never got their link.
    updateError = { code: '08006', message: 'connection failure' };
    expect((await post(delivered)).status).toBe(500);
  });
});
