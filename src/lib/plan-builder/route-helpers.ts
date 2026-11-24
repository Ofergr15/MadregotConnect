import { NextResponse } from 'next/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { requireTraineeAccess } from '@/lib/academy/pairing-server';
import { MigrationPending } from './server';

/** Every plan-builder route: JWT-verified staff caller (BUILD-BRIEF item 8). */
export async function staff(req: Request) {
  const { denied, caller } = await requireStaffCaller(req);
  if (denied) return { denied, me: '', caller };
  // Night queue #65: `me` is written to UUID columns (plan_edit_locks.editor_id, published_by, created_by).
  // A staff caller with no athletes row used to fall back to their email and fail there with a 500.
  if (!caller?.athleteId) return { denied: noAthlete(), me: '', caller };
  return { denied: null, me: caller.athleteId as string, caller };
}

function noAthlete() {
  return NextResponse.json({ error: 'this account has no athlete row', code: 'no_athlete' }, { status: 403 });
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
  const { denied, caller, pair } = await requireTraineeAccess(req, who);
  if (denied) return { denied, me: '', caller, who };
  // A personal week only for an academy trainee: one for a club runner would shadow the
  // group plan they follow (every reader prefers an individual row).
  if (!pair?.isAcademy) {
    return { denied: NextResponse.json({ error: 'not an academy trainee', code: 'not_academy' }, { status: 403 }), me: '', caller, who };
  }
  if (!caller?.athleteId) return { denied: noAthlete(), me: '', caller, who };
  return { denied: null, me: caller.athleteId as string, caller, who };
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
