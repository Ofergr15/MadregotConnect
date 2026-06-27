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
    console.error('Garmin auth error:', error);
    return NextResponse.json(
      { error: 'Failed to authenticate with Garmin. Check credentials.' },
      { status: 401 }
    );
  }
}
