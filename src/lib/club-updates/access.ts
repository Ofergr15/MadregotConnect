import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { accessFor, type Access, type ClubUpdatesConfig } from './model';
import { readConfig } from './server';

/** The caller, the switch, and what the one allows the other (lib/club-updates/model accessFor). */
export async function clubUpdatesCaller(request: Request): Promise<
  | { denied: Response; db?: never; athleteId?: never; access?: never; cfg?: never }
  | { denied: null; db: ReturnType<typeof createServerClient>; athleteId: string | null; access: Access; cfg: ClubUpdatesConfig }
> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  const db = createServerClient();
  const cfg = await readConfig(db);
  const admin = caller.isSuperUser || hasRole(caller, 'admin');
  return { denied: null, db, athleteId: caller.athleteId, access: accessFor(cfg, caller.athleteId, admin), cfg };
}

export const forbidden = () => NextResponse.json({ error: 'Not allowed' }, { status: 403 });
