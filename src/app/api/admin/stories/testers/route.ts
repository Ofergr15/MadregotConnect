import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireBirthdayAdmin } from '@/lib/birthday-year/access';

export const dynamic = 'force-dynamic';

/** POST {athleteId} adds a story tester; DELETE ?athleteId= removes one. Admin only. */
export async function POST(request: Request) {
  const { denied, caller } = await requireBirthdayAdmin(request);
  if (denied) return denied;
  const { athleteId } = (await request.json().catch(() => ({}))) as { athleteId?: string };
  if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  const db = createServerClient();
  const { error } = await db.from('story_testers')
    .upsert({ athlete_id: athleteId, added_by: caller.athleteId }, { onConflict: 'athlete_id', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: 'save failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { denied } = await requireBirthdayAdmin(request);
  if (denied) return denied;
  const athleteId = new URL(request.url).searchParams.get('athleteId');
  if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  const { error } = await createServerClient().from('story_testers').delete().eq('athlete_id', athleteId);
  if (error) return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
