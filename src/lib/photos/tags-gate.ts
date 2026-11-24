import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import type { TagActor } from '@/lib/photos/tags';

/** Verified member with an athlete row and `photo_tags` on for them; else the Response to return. */
export async function tagsGate(request: Request): Promise<{ denied: Response; actor?: undefined } | { denied?: undefined; actor: TagActor }> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  if (!caller.athleteId) return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  if (!(await isFeatureEnabled('photo_tags', caller.athleteId).catch(() => false))) {
    return { denied: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { actor: { athleteId: caller.athleteId, isStaff: caller.isStaff || caller.isSuperUser } };
}
