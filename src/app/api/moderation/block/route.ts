import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { moderationUnmigrated, unmigratedResponse, UUID_RE } from '@/lib/moderation/blocks';

export const dynamic = 'force-dynamic';

/**
 * Member blocks (App Store guideline 1.2, migration 203). Self only: the blocker is
 * the JWT's athlete, never a body field, and the list is private to its owner.
 *
 * GET                  → { blocked: [athleteId] }
 * POST   { athleteId } → { ok: true }   (idempotent)
 * DELETE { athleteId } → { ok: true }   (idempotent; ?athleteId= also accepted)
 *
 * 503 while 203 is unapplied. The blocked member is never told.
 */
async function self(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  if (!caller.athleteId) return { denied: NextResponse.json({ error: 'no athlete' }, { status: 403 }) };
  return { athleteId: caller.athleteId };
}

async function targetOf(request: Request): Promise<string | null> {
  const body = await request.json().catch(() => null);
  const id = body?.athleteId ?? new URL(request.url).searchParams.get('athleteId');
  return typeof id === 'string' && UUID_RE.test(id) ? id : null;
}

export async function GET(request: Request) {
  const c = await self(request);
  if (c.denied) return c.denied;
  const db = createServerClient();
  const { data, error } = await db.from('athlete_blocks').select('blocked_athlete_id').eq('blocker_athlete_id', c.athleteId);
  if (moderationUnmigrated(error)) return unmigratedResponse();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ blocked: (data || []).map((r: { blocked_athlete_id: string }) => r.blocked_athlete_id) });
}

export async function POST(request: Request) {
  const c = await self(request);
  if (c.denied) return c.denied;
  const target = await targetOf(request);
  if (!target) return NextResponse.json({ error: 'invalid athleteId' }, { status: 400 });
  if (target === c.athleteId) return NextResponse.json({ error: 'cannot block yourself' }, { status: 400 });
  const db = createServerClient();
  const { error } = await db
    .from('athlete_blocks')
    .upsert(
      { blocker_athlete_id: c.athleteId, blocked_athlete_id: target },
      { onConflict: 'blocker_athlete_id,blocked_athlete_id', ignoreDuplicates: true },
    );
  if (moderationUnmigrated(error)) return unmigratedResponse();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const c = await self(request);
  if (c.denied) return c.denied;
  const target = await targetOf(request);
  if (!target) return NextResponse.json({ error: 'invalid athleteId' }, { status: 400 });
  const db = createServerClient();
  const { error } = await db
    .from('athlete_blocks')
    .delete()
    .eq('blocker_athlete_id', c.athleteId)
    .eq('blocked_athlete_id', target);
  if (moderationUnmigrated(error)) return unmigratedResponse();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
