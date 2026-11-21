import { NextResponse } from 'next/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { MigrationPending } from './server';

/** Every plan-builder route: JWT-verified staff caller (BUILD-BRIEF item 8). */
export async function staff(req: Request) {
  const { denied, caller } = await requireStaffCaller(req);
  return { denied, me: caller.athleteId || caller.email, caller };
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
