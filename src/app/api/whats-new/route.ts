import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { APP_VERSION } from '@/lib/version';
import {
  BUNDLED_NOTES, isSha, shownNotes, unreleased,
  type NotePick, type ReleaseNote, type ReleaseRow,
} from '@/lib/release-notes';
import { activeApproval, deployedSha, mainHead, markShipped, notesAt, onProduction } from '@/lib/release-server';

export const dynamic = 'force-dynamic';

// "What's new" — see src/lib/release-notes.ts for how the pieces fit.
//
// GET   any member: the recent releases, each with its notes as shown.
//       staff also get `pending` (every note on main no release has carried),
//       `mainSha`, and `approval`: the commit he approved, which is the only
//       thing the 05:00 run will ship.
// PATCH staff: { note_id, featured?, title?, body? } — one pick.
// POST  staff: { sha } — approve that main commit as the next release.
// DELETE staff: withdraw the standing approval; nothing goes out.
//
// Until migration 121 is applied both tables are missing (42P01); GET then
// answers with nothing, which the sheet reads as "nothing to show".

const MISSING = '42P01';

/**
 * The first request a release deploy serves writes its row. Only a deploy of
 * the production branch does: a preview of main, or local dev, sharing this DB
 * must not announce anything.
 */
async function recordThisRelease(supabase: ReturnType<typeof createServerClient>, releases: ReleaseRow[]) {
  if (!onProduction()) return null;
  if (releases.some(r => r.app_version === APP_VERSION)) return null;
  const ids = unreleased(BUNDLED_NOTES, releases).map(n => n.id);
  const { data } = await supabase
    .from('releases')
    .upsert({ app_version: APP_VERSION, note_ids: ids }, { onConflict: 'app_version', ignoreDuplicates: true })
    .select('id, released_at, app_version, note_ids')
    .maybeSingle();
  return (data as ReleaseRow | null) ?? null;
}

export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const staff = caller.isStaff || caller.isSuperUser;
  const supabase = createServerClient();

  const rel = await supabase
    .from('releases')
    .select('id, released_at, app_version, note_ids')
    .order('id', { ascending: false })
    .limit(60);
  if (rel.error) {
    if (rel.error.code === MISSING) return NextResponse.json({ releases: [], pending: [], appVersion: APP_VERSION, staff });
    return NextResponse.json({ error: rel.error.message }, { status: 500 });
  }
  let releases = (rel.data ?? []) as ReleaseRow[];
  await markShipped(supabase);
  const recorded = await recordThisRelease(supabase, releases);
  if (recorded) releases = [recorded, ...releases];

  const picksRes = await supabase.from('release_note_picks').select('note_id, featured, title, body');
  const picks = (picksRes.data ?? []) as NotePick[];

  // Staff read main at a pinned commit, the same one an approval would pin, so
  // what he approves is exactly what he was shown.
  const mainSha = staff ? await mainHead() : null;
  const notes = (mainSha && await notesAt(mainSha)) || BUNDLED_NOTES;
  const approval = staff ? await activeApproval(supabase) : null;
  const all = [...new Map([...BUNDLED_NOTES, ...notes].map(n => [n.id, n])).values()];

  const body = {
    appVersion: APP_VERSION,
    staff,
    releases: releases.slice(0, 30).map(r => ({
      id: r.id,
      released_at: r.released_at,
      app_version: r.app_version,
      notes: shownNotes(r.note_ids, all, picks, { staff }),
    })),
    pending: staff
      ? shownNotes(unreleased(notes, releases).map(n => n.id), all, picks, { staff: true })
      : [],
    mainSha,
    deployedSha: staff ? deployedSha() : null,
    approval,
  };
  return NextResponse.json(body);
}

export async function PATCH(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const b = await request.json().catch(() => null) as Partial<NotePick> | null;
  if (!b || typeof b.note_id !== 'string' || !b.note_id) {
    return NextResponse.json({ error: 'note_id required' }, { status: 400 });
  }
  const row: Record<string, unknown> = { note_id: b.note_id, updated_at: new Date().toISOString(), updated_by: caller.athleteId };
  if (typeof b.featured === 'boolean') row.featured = b.featured;
  if (b.title !== undefined) row.title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 80) : null;
  if (b.body !== undefined) row.body = typeof b.body === 'string' && b.body.trim() ? b.body.trim().slice(0, 300) : null;

  const supabase = createServerClient();
  // The column defaults to true; a first pick that only rewords a note must not
  // star it — nothing is featured unless he stars it.
  const { data: existing } = await supabase.from('release_note_picks').select('note_id').eq('note_id', b.note_id).maybeSingle();
  if (!existing && row.featured === undefined) row.featured = false;
  const { error } = await supabase.from('release_note_picks').upsert(row, { onConflict: 'note_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const b = await request.json().catch(() => null) as { sha?: unknown } | null;
  if (!isSha(b?.sha)) return NextResponse.json({ error: 'sha required' }, { status: 400 });
  const notes = await notesAt(b.sha);
  if (!notes) return NextResponse.json({ error: 'commit not readable' }, { status: 400 });

  const supabase = createServerClient();
  const rel = await supabase.from('releases').select('note_ids');
  const ids = unreleased(notes, (rel.data ?? []) as Pick<ReleaseRow, 'note_ids'>[]).map(n => n.id);
  const { error } = await supabase.from('release_approvals')
    .insert({ sha: b.sha, note_ids: ids, approved_by: caller.athleteId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const supabase = createServerClient();
  const { error } = await supabase.from('release_approvals').delete().is('shipped_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
