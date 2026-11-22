import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { garminLogin, garminVerifyMfa } from '@/lib/garmin/auth-mfa';
import { loadDataSourcesStatus, storeGarminTokens } from '@/lib/data-sources/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/me/data-sources/garmin/password — the fallback when Garmin's own page
 * won't open. Self-only (JWT).
 *
 *   { email, password }            → { ok, status } | { mfaRequired, sessionId }
 *   { email, sessionId, mfaCode }  → { ok, status }
 *
 * The password is sent to Garmin once and dropped; only the resulting tokens are
 * stored, encrypted, by this route — the blob is never returned. Nothing from the
 * body is ever logged.
 */
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  const mfaCode = typeof body?.mfaCode === 'string' ? body.mfaCode.trim() : '';

  try {
    let tokens: unknown;
    if (sessionId && mfaCode) {
      const r = await garminVerifyMfa(sessionId, mfaCode);
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: 401 });
      tokens = r.tokens;
    } else {
      if (!email || !password) return NextResponse.json({ error: 'יש להזין אימייל וסיסמה' }, { status: 400 });
      const r = await garminLogin(email, password);
      if ('error' in r) {
        return NextResponse.json({ error: r.error }, { status: r.error.includes('locked') ? 429 : 401 });
      }
      if ('mfaRequired' in r) return NextResponse.json({ mfaRequired: true, sessionId: r.sessionId });
      tokens = r.tokens;
    }
    const db = createServerClient();
    await storeGarminTokens(db, auth.user.athleteId, tokens, email, 'password');
    return NextResponse.json({ ok: true, status: await loadDataSourcesStatus(db, auth.user.athleteId) });
  } catch (error: any) {
    // Status code only: axios errors carry the request config, which holds the body.
    console.error('garmin native password: failed', error?.response?.status ?? error?.code);
    return NextResponse.json({ error: 'ההתחברות נכשלה. נסו שוב.' }, { status: 500 });
  }
}
