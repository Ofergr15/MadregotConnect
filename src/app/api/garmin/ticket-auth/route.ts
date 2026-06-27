import { NextRequest, NextResponse } from 'next/server';
import { GarminConnect } from 'garmin-connect';
import { encrypt } from '@/lib/encryption';

export async function POST(req: NextRequest) {
  try {
    const { ticket } = await req.json();

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket is required' },
        { status: 400 }
      );
    }

    // Use garmin-connect to exchange ticket for OAuth tokens
    const gc = new GarminConnect({ username: '', password: '' });

    // Access internal client to exchange ticket directly
    const client = (gc as any).client;
    const oauth1 = await client.getOauth1Token(ticket);
    await client.getOauth2Token(oauth1);
    const tokens = gc.exportToken();

    const auth = {
      email: 'sso-login',
      tokens: tokens as unknown as Record<string, unknown>,
      lastAuth: new Date().toISOString(),
    };

    const encryptedAuth = encrypt(auth);

    return NextResponse.json({
      success: true,
      auth: encryptedAuth,
    });
  } catch (error: any) {
    console.error('Garmin ticket auth error:', error);
    return NextResponse.json(
      { error: 'Failed to authenticate with Garmin ticket.' },
      { status: 401 }
    );
  }
}
