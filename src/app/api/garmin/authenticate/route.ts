import { NextRequest, NextResponse } from 'next/server';
import { GarminClient } from '@/lib/garmin/client';
import { encrypt } from '@/lib/encryption';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const auth = await GarminClient.authenticate(email, password);
    const encryptedAuth = encrypt(auth);

    return NextResponse.json({
      success: true,
      auth: encryptedAuth,
    });
  } catch (error: any) {
    console.error('Garmin auth error:', error?.message, error?.cause || '');
    const msg = error?.message?.toLowerCase() || '';
    if (msg.includes('mfa') || msg.includes('two-factor') || msg.includes('verification')) {
      return NextResponse.json(
        { error: 'Garmin account has MFA enabled. Please disable 2FA in Garmin Connect settings and try again.' },
        { status: 401 }
      );
    }
    if (msg.includes('locked') || msg.includes('too many')) {
      return NextResponse.json(
        { error: 'Account temporarily locked due to too many attempts. Wait a few minutes and try again.' },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to authenticate with Garmin. Check your credentials or try again in a few minutes.' },
      { status: 401 }
    );
  }
}
