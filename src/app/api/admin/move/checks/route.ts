import { NextResponse } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';
import { runMoveChecks } from '@/lib/move/checks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The JWT's issuer host, read without verifying: requireSession already did. */
function issHost(request: Request): string | null {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  try {
    const iss = (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { iss?: string }).iss;
    return iss ? new URL(iss).hostname : null;
  } catch { return null; }
}

// POST /api/admin/move/checks — run the move's check suite (lib/move/checks.ts). Super user only.
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isSuperUser) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  const started = Date.now();
  const results = await runMoveChecks({ athleteId: auth.user.athleteId, tokenIssHost: issHost(request) });
  return NextResponse.json({ results, ms: Date.now() - started, at: new Date().toISOString() });
}
