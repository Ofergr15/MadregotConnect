import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { APP_URL } from '@/lib/constants';
import { exchangeTicketForTokens } from '@/lib/garmin/auth-mfa';
import { garminNativeServiceUrl, isPlausibleGarminTicket } from '@/lib/data-sources/native';
import { loadDataSourcesStatus, storeGarminTokens } from '@/lib/data-sources/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/me/data-sources/garmin/ticket  { ticket }
 *
 * Exchanges a Garmin SSO ticket and writes `athletes.garmin_auth` server-side.
 * Self-only (JWT). Unlike /api/garmin/ticket-auth, the encrypted blob is NOT
 * returned — the response is the same status GET serves.
 *
 * SSO tickets are bound to the service they were issued for, so the exchange is
 * tried with the app's service URL first; `sso/embed` second, in case Garmin's
 * OAuth preauthorize only honours its own login URL. Which one worked is the
 * spike's open question — logged by kind, never with the ticket.
 */
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const body = await request.json().catch(() => ({}));
  const ticket = body?.ticket;
  if (!isPlausibleGarminTicket(ticket)) {
    return NextResponse.json({ error: 'invalid ticket' }, { status: 400 });
  }

  let tokens: unknown;
  try {
    tokens = await exchangeTicketForTokens(ticket, garminNativeServiceUrl(APP_URL));
    console.info('garmin native sso: exchanged', { loginUrl: 'service' });
  } catch (first: any) {
    try {
      tokens = await exchangeTicketForTokens(ticket);
      console.info('garmin native sso: exchanged', { loginUrl: 'embed' });
    } catch (second: any) {
      console.error('garmin native sso: exchange failed', first?.response?.status, second?.response?.status);
      return NextResponse.json({ error: 'garmin_rejected' }, { status: 401 });
    }
  }

  const db = createServerClient();
  try {
    await storeGarminTokens(db, auth.user.athleteId, tokens, 'sso-login', 'sso');
    return NextResponse.json({ ok: true, status: await loadDataSourcesStatus(db, auth.user.athleteId) });
  } catch (error: any) {
    console.error('garmin native sso: store failed', error?.code);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
