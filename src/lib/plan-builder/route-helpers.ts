import { NextResponse } from 'next/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { requireTraineeAccess } from '@/lib/academy/pairing-server';
import { MigrationPending } from './server';

/** Every plan-builder route: JWT-verified staff caller (BUILD-BRIEF item 8). */
export async function staff(req: Request) {
  const { denied, caller } = await requireStaffCaller(req);
  return { denied, me: caller.athleteId || caller.email, caller };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every /weeks/[week]/* route: `?athleteId=<uuid>` selects that trainee's own week and gates on
 * `requireTraineeAccess` (the academy manager, or that trainee's coach) → 403 otherwise.
 * Without it: the group week behind the staff gate, exactly as before.
 */
export async function gate(req: Request): Promise<{ denied: Response | null; me: string; caller: any; who: string | null }> {
  const raw = new URL(req.url).searchParams.get('athleteId');
  if (raw === null || raw === '') {
    const s = await staff(req);
    return { ...s, who: null };
  }
  const who = raw.trim();
  if (!UUID_RE.test(who)) {
    return { denied: NextResponse.json({ error: 'athleteId must be a uuid' }, { status: 400 }), me: '', caller: null, who: null };
  }
  const { denied, caller } = await requireTraineeAccess(req, who);
  return { denied, me: caller?.athleteId || caller?.email, caller, who };
}

export const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
export function badWeek(week: string) {
  if (!WEEK_RE.test(week) || new Date(`${week}T12:00:00Z`).getUTCDay() !== 0) {
    return NextResponse.json({ error: 'week must be a plan week Sunday (YYYY-MM-DD)' }, { status: 400 });
  }
  return null;
}

export function fail(err: any, what: string) {
  if (err instanceof MigrationPending) return NextResponse.json({ error: err.message, code: 'migration_pending' }, { status: 503 });
  console.error(`[plan-builder] ${what}`, err);
  return NextResponse.json({ error: err?.message || what }, { status: 500 });
}
