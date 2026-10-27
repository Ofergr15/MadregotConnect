import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { addPreview } from '@/lib/core-runner-add';

export const dynamic = 'force-dynamic';

// GET /api/admin/core-runners/preview?athleteId= — what the "add to the core?" sheet shows.
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('athleteId');
  if (!id) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  try {
    return NextResponse.json(await addPreview(createServerClient(), id));
  } catch (err) {
    console.error('[core-runners/preview]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
