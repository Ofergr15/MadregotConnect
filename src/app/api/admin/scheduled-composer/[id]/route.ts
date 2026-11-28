import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { composerGate } from '@/lib/scheduled-composer/gate';
import { MIGRATION_327, MIGRATION_327_TEXT, fromRow, isMissingComposerTable, readComposer, toRow, type ComposerRow } from '@/lib/scheduled-composer/model';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH  — edit any field (merged onto the stored item, validated whole; next time recomputed).
 *          `{ enabled: false }` is the alarm's switch.
 * DELETE — remove it. Approvers/admins, never while viewing as.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await composerGate(request, true);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const db = createServerClient();
  const { data: current, error: readErr } = await db.from('scheduled_composer_items').select('*').eq('id', id).maybeSingle();
  if (isMissingComposerTable(readErr)) return NextResponse.json({ error: MIGRATION_327, message: MIGRATION_327_TEXT }, { status: 409 });
  if (readErr) return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = readComposer(await request.json().catch(() => null), fromRow(current as ComposerRow));
  if ('errors' in parsed) return NextResponse.json({ error: parsed.errors[0], errors: parsed.errors }, { status: 400 });
  const row = toRow(parsed.item, Date.now());
  if (parsed.item.enabled && !row.next_run_at) return NextResponse.json({ error: 'That time has already gone by', errors: ['That time has already gone by'] }, { status: 400 });
  const { data, error } = await db.from('scheduled_composer_items').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
  if (error) {
    console.error('[api/admin/scheduled-composer/:id] update failed', error.message);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ item: fromRow(data as ComposerRow) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await composerGate(request, true);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data, error } = await createServerClient().from('scheduled_composer_items').delete().eq('id', id).select('id');
  if (isMissingComposerTable(error)) return NextResponse.json({ error: MIGRATION_327, message: MIGRATION_327_TEXT }, { status: 409 });
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  if (!(data ?? []).length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
