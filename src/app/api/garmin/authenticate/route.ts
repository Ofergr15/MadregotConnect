import { NextRequest, NextResponse } from 'next/server';
import { garminLogin, garminVerifyMfa } from '@/lib/garmin/auth-mfa';
import { encrypt } from '@/lib/encryption';

export async function POST(req: NextRequest) {
  try {
    const { email, password, mfaCode, sessionId } = await req.json();

    // MFA verification step
    if (mfaCode && sessionId) {
      const result = await garminVerifyMfa(sessionId, mfaCode);
      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: 401 });
      }
      const encryptedAuth = encrypt({
        email,
        tokens: result.tokens,
        lastAuth: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, auth: encryptedAuth });
    }

    // Initial login step
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const result = await garminLogin(email, password);

    if ('error' in result) {
      const status = result.error.includes('locked') ? 429 : 401;
      return NextResponse.json({ error: result.error }, { status });
    }

    if ('mfaRequired' in result) {
      return NextResponse.json({
        mfaRequired: true,
        sessionId: result.sessionId,
      });
    }

    const encryptedAuth = encrypt({
      email,
      tokens: result.tokens,
      lastAuth: new Date().toISOString(),
    });
    return NextResponse.json({ success: true, auth: encryptedAuth });
  } catch (error: any) {
    console.error('Garmin auth error:', error?.message);
    return NextResponse.json(
      { error: 'Authentication failed. Please try again.' },
      { status: 500 }
    );
  }
}
