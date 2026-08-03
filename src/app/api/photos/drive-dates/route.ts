import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, isStaff } from '@/lib/auth/verify';
import { listPhotoDates } from '@/lib/google-drive/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const dates = await listPhotoDates();
    return NextResponse.json({ dates });
  } catch (error: unknown) {
    console.error('GET /api/photos/drive-dates error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
