import { NextRequest, NextResponse } from 'next/server';
import { APP_URL } from '@/lib/constants';

export async function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get('ticket') || '';
  // `encodeURIComponent`, because a Garmin ticket is an opaque string we don't
  // control: interpolated raw, a '&' in it would split into a second query param
  // and a '#' would truncate everything after it, so the callback page would read
  // a silently shortened ticket and the connect flow would fail with nothing in
  // the logs to explain why. Also fixes the host — see APP_URL in lib/constants.
  return NextResponse.redirect(`${APP_URL}/garmin-callback?ticket=${encodeURIComponent(ticket)}`);
}
