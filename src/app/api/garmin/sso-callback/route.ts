import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get('ticket') || '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://madregot-connect.vercel.app';
  return NextResponse.redirect(`${appUrl}/garmin-callback?ticket=${ticket}`);
}
