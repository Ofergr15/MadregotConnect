import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { APP_VERSION } from '@/lib/version';
import {
  BUNDLED_NOTES, MAIN_NOTES_URL, RELEASE_BRANCH,
  shownNotes, unreleased, type NotePick, type ReleaseNote, type ReleaseRow,
} from '@/lib/release-notes';

export const dynamic = 'force-dynamic';

// "What's new" — see src/lib/release-notes.ts for how the pieces fit.
//
// GET   any member: the recent releases, each with its notes as shown.
//       staff also get `pending`: what tomorrow's 05:00 release will carry,
//       read from main (the repo is public), so the day's picks can be made
//       before it goes out.
// PATCH staff: { note_id, featured?, title?, body? } — one pick.
//
// Until migration 121 is applied both tables are missing (42P01); GET then
// answers with nothing, which the sheet reads as "nothing to show".

const MISSING = '42P01';

/**
 * The first request a release deploy serves writes its row. Only a deploy of
 * the release branch does: a preview of main, or local dev, sharing this DB
 * must not announce anything.
 */
async function recordThisRelease(supabase: ReturnType<typeof createServerClient>, releases: ReleaseRow[]) {
  if (process.env.VERCEL_GIT_COMMIT_REF !== RELEASE_BRANCH) return null;
  if (releases.some(r => r.app_version === APP_VERSION)) return null;
  const ids = unreleased(BUNDLED_NOTES, releases).map(n => n.id);
  const { data } = await supabase
    .from('releases')
    .upsert({ app_version: APP_VERSION, note_ids: ids }, { onConflict: 'app_version', ignoreDuplicates: true })
    .select('id, released_at, app_version, note_ids')
    .maybeSingle();
  return (data as ReleaseRow | null) ?? null;
}

async function mainNotes(): Promise<ReleaseNote[]> {
  try {
    const res = await fetch(MAIN_NOTES_URL, { next: { revalidate: 60 } });
    if (!res.ok) return BUNDLED_NOTES;
    const json = await res.json();
    return Array.isArray(json) ? (json as ReleaseNote[]) : BUNDLED_NOTES;
  } catch {
    return BUNDLED_NOTES;
  }
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
  const recorded = await recordThisRelease(supabase, releases);
  if (recorded) releases = [recorded, ...releases];

  const picksRes = await supabase.from('release_note_picks').select('note_id, featured, title, body');
  const picks = (picksRes.data ?? []) as NotePick[];

  // Notes come from main for staff: a pick made on a note that exists only
  // there yet still has to render once it ships.
  const notes = staff ? await mainNotes() : BUNDLED_NOTES;
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
  // A first pick on a note has to carry the note's current default, or an
  // edit of the wording alone would un-feature a feature.
  const { data: existing } = await supabase.from('release_note_picks').select('note_id').eq('note_id', b.note_id).maybeSingle();
  if (!existing && row.featured === undefined) {
    const note = [...BUNDLED_NOTES, ...(await mainNotes())].find(n => n.id === b.note_id);
    row.featured = note?.kind === 'feature';
  }
  const { error } = await supabase.from('release_note_picks').upsert(row, { onConflict: 'note_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
