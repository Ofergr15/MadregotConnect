import { NextRequest, NextResponse } from 'next/server';
import { GarminConnect } from 'garmin-connect';
import { createServerClient } from '@/lib/supabase/server';
import { resolveGarminTarget, storeGarminAuth } from '@/lib/garmin/store-auth';

export const dynamic = 'force-dynamic';

/**
 * Garmin SSO ticket → credential stored on the caller's row. Same contract as
 * /api/garmin/authenticate: a status only, the blob stays on the server.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ticket = body?.ticket;
    if (!ticket || typeof ticket !== 'string') {
      return NextResponse.json({ error: 'Ticket is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const resolved = await resolveGarminTarget(req, supabase, body);
    if ('denied' in resolved) return resolved.denied;

    const gc = new GarminConnect({ username: '', password: '' });
    const client = (gc as any).client;
    const oauth1 = await client.getOauth1Token(ticket);
    await client.getOauth2Token(oauth1);
    const tokens = gc.exportToken() as unknown as Record<string, unknown>;

    const saved = await storeGarminAuth(req, supabase, resolved.target, { email: 'sso-login', tokens });
    if (!saved.ok) return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
    return NextResponse.json({ connected: true, watchResent: saved.watchResent });
  } catch (error: any) {
    // Never the error object: it carries the ticket in the request config.
    console.error('Garmin ticket auth error:', error?.name, error?.response?.status);
    return NextResponse.json({ error: 'Failed to authenticate with Garmin ticket.' }, { status: 401 });
  }
}
