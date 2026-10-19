import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { storyGate } from '@/lib/stories/gate';

export const dynamic = 'force-dynamic';

/** GET /api/stories/birthday — the gate only (the tester bar). Content: /api/birthday-year. */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const isAdmin = caller.isSuperUser || hasRole(caller, 'admin');
  const gate = await storyGate('birthday', caller.athleteId, { isAdmin });
  if (!gate.allowed) return NextResponse.json({ allowed: false }, { status: 404 });
  return NextResponse.json({ allowed: true, tester: gate.tester, preview: gate.preview, state: gate.state, viewingAs: !!caller.viewingAsBy });
}
