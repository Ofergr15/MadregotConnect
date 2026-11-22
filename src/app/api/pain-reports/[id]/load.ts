import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { PAIN_SELECT, callerMaySeePain, type PainRow } from '@/lib/feedback/pain-server';

/** Shared by the [id] routes: verify, load, decide owner/staff. 404 for a report you may not see. */
export async function loadPain(request: Request, id: string, need: 'owner' | 'staff' | 'any') {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { res: denied } as const;
  const db = createServerClient();
  const { data, error } = await db.from('pain_reports').select(PAIN_SELECT).eq('id', id).maybeSingle();
  if (error || !data) return { res: NextResponse.json({ error: 'not found' }, { status: 404 }) } as const;
  const row = data as PainRow;
  const access = await callerMaySeePain(db, caller, row.athlete_id);
  if (!access) return { res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) } as const;
  if (need !== 'any' && access !== need) return { res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) } as const;
  return { res: null, db, row, caller: caller as VerifiedCaller, access } as const;
}
