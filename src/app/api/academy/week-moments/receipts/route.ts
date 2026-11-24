import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isAcademyManager } from '@/lib/academy/pairing-server';

export const dynamic = 'force-dynamic';

/** GET ?momentId → who received and who read it: { delivered, read, people[{ athleteId, name, readAt }] }.
 *  WHO: the moment's author, or the academy manager. Never a trainee, never another coach. */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('momentId') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'momentId is required' }, { status: 400 });
  const db = createServerClient();
  const { data: m } = await db.from('academy_week_moments').select('author_id').eq('id', id).maybeSingle();
  const author = (m as { author_id?: string } | null)?.author_id;
  if (!author) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (author !== caller.athleteId && !isAcademyManager(caller)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // No embed: receipts carry no FK to athletes (migration 212), so names are their own read.
  const { data } = await db.from('academy_week_moment_receipts').select('athlete_id, read_at').eq('moment_id', id);
  const rows = (data || []) as Array<{ athlete_id: string; read_at: string | null }>;
  const { data: names } = rows.length ? await db.from('athletes').select('id, name').in('id', rows.map((r) => r.athlete_id)) : { data: [] };
  const nameOf = new Map(((names || []) as Array<{ id: string; name: string }>).map((n) => [n.id, n.name]));
  const people = rows
    .map((r) => ({ athleteId: r.athlete_id, name: nameOf.get(r.athlete_id) ?? '', readAt: r.read_at }))
    .sort((a, b) => (a.readAt ? 1 : 0) - (b.readAt ? 1 : 0) || a.name.localeCompare(b.name));
  return NextResponse.json({ delivered: people.length, read: people.filter((p) => p.readAt).length, people });
}
