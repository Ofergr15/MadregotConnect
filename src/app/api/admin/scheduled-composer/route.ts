import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { composerGate } from '@/lib/scheduled-composer/gate';
import { MIGRATION_327, MIGRATION_327_TEXT, fromRow, isMissingComposerTable, readComposer, toRow, type ComposerRow } from '@/lib/scheduled-composer/model';

export const dynamic = 'force-dynamic';

/**
 * The native composer's scheduled messages and polls (task 153, lib/scheduled-composer).
 *   GET  — staff: every item, soonest first, with its next time and repeat label.
 *   POST — approvers/admins: create one (send time, repeat days, audience, importance, push).
 * Nothing here sends: the only reader is the dry-run cron (/api/cron/scheduled-composer).
 */
export async function GET(request: Request) {
  const { denied } = await composerGate(request, false);
  if (denied) return denied;
  const { data, error } = await createServerClient().from('scheduled_composer_items').select('*')
    .order('next_run_at', { ascending: true, nullsFirst: false }).limit(200);
  if (isMissingComposerTable(error)) return NextResponse.json({ error: MIGRATION_327, message: MIGRATION_327_TEXT }, { status: 409 });
  if (error) {
    console.error('[api/admin/scheduled-composer] read failed', error.message);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
  return NextResponse.json({ items: ((data ?? []) as ComposerRow[]).map(fromRow), dryRunOnly: true });
}

export async function POST(request: Request) {
  const { denied, caller } = await composerGate(request, true);
  if (denied) return denied;
  const parsed = readComposer(await request.json().catch(() => null));
  if ('errors' in parsed) return NextResponse.json({ error: parsed.errors[0], errors: parsed.errors }, { status: 400 });
  const row = toRow(parsed.item, Date.now());
  if (parsed.item.enabled && !row.next_run_at) return NextResponse.json({ error: 'That time has already gone by', errors: ['That time has already gone by'] }, { status: 400 });
  const { data, error } = await createServerClient().from('scheduled_composer_items')
    .insert({ ...row, created_by_athlete_id: caller.athleteId, created_by_email: caller.email || null }).select('*').single();
  if (isMissingComposerTable(error)) return NextResponse.json({ error: MIGRATION_327, message: MIGRATION_327_TEXT }, { status: 409 });
  if (error) {
    console.error('[api/admin/scheduled-composer] insert failed', error.message);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ item: fromRow(data as ComposerRow) }, { status: 201 });
}
