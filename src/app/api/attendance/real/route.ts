import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { people, sessionsBetween } from '@/lib/attendance/real-server';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/attendance/real?from=YYYY-MM-DD&to=YYYY-MM-DD — staff only.
 * The team sessions in the range: who ran together (lib/attendance/together.ts), the
 * groups as they ran, and who had said they'd come; with everyone's face and pack.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isSuperUser && !caller.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  const q = new URL(request.url).searchParams;
  const from = q.get('from') || '', to = q.get('to') || '';
  if (!ISO.test(from) || !ISO.test(to) || from > to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });
  // At most ~10 weeks: each held day reads one morning of routes.
  if (Date.parse(to) - Date.parse(from) > 75 * 86_400_000) return NextResponse.json({ error: 'range too long' }, { status: 400 });
  try {
    const db = createServerClient();
    const today = israelToday();
    const [days, folk] = await Promise.all([sessionsBetween(db, from, to, today), people(db)]);
    const ids = new Set(days.flatMap((d) => [...d.came, ...d.said]));
    const active = Object.values(folk).filter((p) => p.active);
    return NextResponse.json({
      today,
      days,
      people: Object.fromEntries([...ids].filter((id) => folk[id]).map((id) => [id, folk[id]])),
      // How many each pack (and the academy) has, for "6.8 of 10".
      sizes: {
        1: active.filter((p) => p.pack === 1 && !p.academy).length,
        2: active.filter((p) => p.pack === 2 && !p.academy).length,
        3: active.filter((p) => p.pack === 3 && !p.academy).length,
        academy: active.filter((p) => p.academy).length,
      },
    });
  } catch (err) {
    console.error('attendance/real failed:', err);
    return NextResponse.json({ error: 'Failed to read attendance' }, { status: 500 });
  }
}
