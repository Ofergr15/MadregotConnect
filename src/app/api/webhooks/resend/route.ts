import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/resend — the other half of knowing whether a mail arrived.
 *
 * `status='sent'` only means Resend ACCEPTED the message. The receiving server can
 * still refuse it afterwards, and that rejection is invisible to us: our HTTP call
 * succeeded minutes earlier. For an app whose approval mail is the only way into the
 * club, "accepted" is not good enough — a bounced Gmail address looks identical to a
 * delivered one on every screen.
 *
 * So Resend tells us, and we promote the email_log row: sent → delivered / bounced /
 * complained. Nothing else in the app changes behaviour off the back of it; it exists
 * so the registrations screen can say "this one bounced" instead of "sent".
 *
 * ── SETUP (both halves, or this is inert) ─────────────────────────────────────────
 *   1. Resend → Webhooks → add `https://www.madregot.app/api/webhooks/resend`,
 *      subscribed to email.delivered / email.bounced / email.complained /
 *      email.delivery_delayed.
 *   2. Set `RESEND_WEBHOOK_SECRET` (the `whsec_…` value) in Vercel.
 *
 * ⚠️ SECURITY. This is an UNAUTHENTICATED public endpoint — it has to be, webhooks
 * carry no session. Two rules keep it safe:
 *   • With no secret configured it accepts NOTHING (503). An unsigned body from the
 *     open internet must never reach the database, and silently trusting one would be
 *     a write primitive for anybody who found the URL.
 *   • Signature verified before the body is parsed for meaning, timing-safely.
 * It can only ever move a status on a row keyed by a provider id Resend issued, so even
 * a forged-but-signed payload cannot create rows or touch anything else.
 */

/** Resend signs with Svix: HMAC-SHA256 over `id.timestamp.body`, base64. */
function verify(secret: string, headers: Headers, body: string): boolean {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signature = headers.get('svix-signature');
  if (!id || !timestamp || !signature) return false;

  // Replay window. Without it a captured payload is valid forever.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  // The secret is `whsec_<base64>`; the base64 half is the actual key bytes.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');

  // The header is a space-separated list of `v1,<sig>` — more than one during a secret
  // rotation, so any match counts.
  return signature.split(' ').some(part => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Only the events that change what we believe. `email.sent` is ignored: we already
 *  wrote that row ourselves, and letting it back in would demote a `delivered`. */
const STATUS_BY_EVENT: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delayed',
};

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Deliberately not 200: a silent no-op would show as healthy in Resend's dashboard
    // while nothing was being recorded. 503 makes the missing config visible there.
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 });
  }

  const body = await request.text();
  if (!verify(secret, request.headers, body)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  const status = STATUS_BY_EVENT[event.type || ''];
  const providerId = event.data?.email_id;
  // 200 for an event we don't care about: a non-2xx makes Resend retry it forever.
  if (!status || !providerId) return NextResponse.json({ ok: true, ignored: event.type || null });

  try {
    const { error } = await createServerClient()
      .from('email_log')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('provider_id', providerId);
    if (error && error.code !== '42P01') throw error;
  } catch (err) {
    // 500 so Resend retries — a bounce we failed to record is worth another attempt.
    console.error('Failed to record a Resend webhook event:', err);
    return NextResponse.json({ error: 'could not record' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status });
}
