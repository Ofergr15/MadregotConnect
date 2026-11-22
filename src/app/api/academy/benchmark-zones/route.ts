import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { parseTime } from '@/lib/academy/benchmark';
import { proposedZones, repaceOffset } from '@/lib/academy/benchmark-zones';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/benchmark-zones?athleteId=&time=7:41&prev=7:58 — PROPOSED zones from a
 * 2000 m result. Read-only arithmetic (nothing is written; applying is the existing
 * pace-update flow). Gated like the trainee's record: self, their coaches, the manager.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const sp = new URL(request.url).searchParams;
  const athleteId = sp.get('athleteId') || '';
  if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  if (!(await mayCoach(caller, athleteId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const t = parseTime(sp.get('time') || '');
  const zones = t == null ? null : proposedZones(t);
  if (!zones) return NextResponse.json({ error: 'implausible time' }, { status: 400 });
  const prev = parseTime(sp.get('prev') || '');
  return NextResponse.json({ zones, offsetSec: repaceOffset(prev, t!) });
}
