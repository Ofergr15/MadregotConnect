import { NextRequest, NextResponse } from 'next/server';
import { garminLogin, garminVerifyMfa } from '@/lib/garmin/auth-mfa';
import { createServerClient } from '@/lib/supabase/server';
import { resolveGarminTarget, storeGarminAuth } from '@/lib/garmin/store-auth';

export const dynamic = 'force-dynamic';

/**
 * Garmin email/password (+ MFA) → credential stored on the caller's row.
 *
 * Answers with a status only: `{ connected: true, watchResent }`,
 * `{ mfaRequired: true, sessionId }`, or `{ error }`. The encrypted credential
 * never leaves the server (lib/garmin/store-auth.ts says who may connect which
 * row). The target is resolved BEFORE Garmin is called, so an unauthorised
 * caller can't use this route as a Garmin password oracle either.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, password, mfaCode, sessionId } = body ?? {};

    const supabase = createServerClient();
    const resolved = await resolveGarminTarget(req, supabase, body ?? {});
    if ('denied' in resolved) return resolved.denied;

    let tokens: Record<string, unknown>;
    if (mfaCode && sessionId) {
      const result = await garminVerifyMfa(sessionId, mfaCode);
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: 401 });
      tokens = result.tokens as unknown as Record<string, unknown>;
    } else {
      if (!email || !password) {
        return NextResponse.json({ error: 'יש להזין אימייל וסיסמה' }, { status: 400 });
      }
      const result = await garminLogin(email, password);
      if ('error' in result) {
        const status = result.error.includes('locked') ? 429 : 401;
        return NextResponse.json({ error: result.error }, { status });
      }
      if ('mfaRequired' in result) {
        return NextResponse.json({ mfaRequired: true, sessionId: result.sessionId });
      }
      tokens = result.tokens as unknown as Record<string, unknown>;
    }

    const saved = await storeGarminAuth(req, supabase, resolved.target, { email: email || 'garmin-login', tokens });
    if (!saved.ok) return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
    return NextResponse.json({ connected: true, watchResent: saved.watchResent });
  } catch (error: any) {
    // Status only — never the error object: axios errors carry the request
    // config, i.e. the password / ticket that was being exchanged.
    console.error('Garmin auth error:', error?.name, error?.response?.status);
    return NextResponse.json({ error: 'ההתחברות נכשלה. נסו שוב.' }, { status: 500 });
  }
}
