import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isAcademyManager } from '@/lib/academy/pairing-server';
import { isLibraryKind } from '@/lib/academy/library';
import { fromLibrarySteps } from '@/lib/academy/book-steps';
import { classifyWorkout } from '@/lib/academy/book-classify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The book's classification, in bulk (Ofer 10-23: "recognise each workout yourself and I
 * approve — and everything I marked, go over it again from zero"). Manager only.
 *   POST { action: 'reset' }                 → every entry back to unconfirmed, its type the
 *                                               new detection (lib/academy/book-classify)
 *   POST { items: [{ id, kind }] }           → confirm many at once ("לאשר את כולם")
 */
export async function POST(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!isAcademyManager(caller)) return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; items?: Array<{ id?: string; kind?: string }> };
  const db = createServerClient();
  const now = new Date().toISOString();

  if (body.action === 'reset') {
    const { data, error } = await db.from('academy_workout_library').select('id, name, steps').is('archived_at', null);
    if (error) return NextResponse.json({ error: 'read failed' }, { status: 500 });
    let n = 0;
    await Promise.all(((data || []) as Array<{ id: string; name: string | null; steps: unknown }>).map(async (r) => {
      const kind = classifyWorkout(fromLibrarySteps(r.steps as never), r.name || '').kind;
      const { error: e } = await db.from('academy_workout_library').update({ kind, kind_confirmed: false, updated_at: now }).eq('id', r.id);
      if (!e) n++;
    }));
    return NextResponse.json({ ok: true, reset: n });
  }

  const items = (body.items || []).filter((x): x is { id: string; kind: string } => typeof x.id === 'string' && isLibraryKind(x.kind)).slice(0, 500);
  if (!items.length) return NextResponse.json({ error: 'nothing to save' }, { status: 400 });
  const results = await Promise.all(items.map((x) => db.from('academy_workout_library')
    .update({ kind: x.kind, kind_confirmed: true, updated_at: now }).eq('id', x.id).is('archived_at', null)));
  return NextResponse.json({ ok: true, saved: results.filter((r) => !r.error).length });
}
