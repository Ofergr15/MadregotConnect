import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import {
  hasAbsolutePaces,
  isLibraryKind,
  isLibraryScope,
  type LibraryEntry,
  type LibraryStep,
} from '@/lib/academy/library';

export const dynamic = 'force-dynamic';

/**
 * The workout book (ספר האימונים).
 *
 *   GET    /api/academy/library            → every entry this coach may see
 *   POST   /api/academy/library            → write one
 *   PATCH  /api/academy/library            → edit, duplicate, archive, or record a push
 *
 * STAFF ONLY, all of it. The book is the coach's writing tool; a trainee sees the workouts
 * that were pushed to them, never the shelf they came from.
 *
 * ── Who may write to the canon ────────────────────────────────────────────────
 *
 * Ofer's own open question 8 is "ספר האימונים — שלך או של האקדמיה?", i.e. may a mentor
 * write a workout into the book or does writing stay with him. The two shelves make that a
 * PERMISSION rather than a schema decision, and the permission is right here in one
 * constant: a coach writes freely to their own shelf, and `academy` — the canon every
 * mentor pushes from — takes a manager. That is the answer that needs no decision to be
 * safe, because it is the only one where a wrong guess costs nobody anything: a mentor who
 * turns out to be trusted with the canon gains it by a one-word change, while the reverse
 * mistake means a mentor's first draft is what the whole academy pushed last week.
 *
 * Reading the canon is open to all staff. It has to be — a shelf nobody can push from is
 * not a book.
 */

/** The columns, mapped once so the pure lib never sees snake_case. */
const COLUMNS =
  'id, scope, owner_id, name, kind, notes, steps, use_count, last_used_at, created_at, athletes(name)';

function toEntry(row: any): LibraryEntry {
  return {
    id: String(row.id),
    // An unrecognised value reads as the coach's own shelf, never as the canon: the failure
    // direction that matters is a private draft appearing in the academy's book.
    scope: row.scope === 'academy' ? 'academy' : 'mine',
    ownerId: row.owner_id ? String(row.owner_id) : '',
    ownerName: row.athletes?.name ?? null,
    name: String(row.name || ''),
    kind: isLibraryKind(row.kind) ? row.kind : 'easy',
    notes: row.notes ?? null,
    steps: Array.isArray(row.steps) ? (row.steps as LibraryStep[]) : [],
    useCount: Number(row.use_count || 0),
    lastUsedAt: row.last_used_at ?? null,
    createdAt: String(row.created_at || ''),
  };
}

/** Migration 109 is pasted in by hand, so every handler has to survive its absence. */
const NOT_SET_UP = { entries: [], tableMissing: true };

/**
 * The steps a write may store, or a reason to refuse.
 *
 * `hasAbsolutePaces` is the invariant the whole feature rests on and cannot be a CHECK
 * constraint — the steps are JSONB and the rule is about which keys are ABSENT inside them.
 * So it is enforced at the one place a step enters the table. An entry carrying 4:05/km is
 * not a slightly-wrong entry: it is the single-runner workout the book exists to stop
 * existing, and it fails silently, because it looks perfectly correct to whichever coach
 * happens to share that threshold.
 */
function validateSteps(steps: unknown): { steps: LibraryStep[] } | { error: string } {
  if (!Array.isArray(steps) || steps.length === 0) return { error: 'A workout needs at least one step' };
  const typed = steps as LibraryStep[];
  if (hasAbsolutePaces(typed)) {
    return { error: 'A library workout stores an intensity, not a pace' };
  }
  return { steps: typed };
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('academy_workout_library')
      .select(COLUMNS)
      .is('archived_at', null)
      .order('use_count', { ascending: false });

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP);
      return NextResponse.json({ error: 'Failed to read the library' }, { status: 500 });
    }

    // The canon, plus this coach's own shelf. Filtered here and not in the query because
    // `scope = 'academy' OR owner_id = me` in PostgREST's `.or()` is a string the next
    // reader has to decode, and the book is 34 rows.
    const entries = (data || [])
      .map(toEntry)
      .filter(e => e.scope === 'academy' || (caller.athleteId && e.ownerId === caller.athleteId));

    // Who is reading, in the two terms the screen needs: a manager gets the shelf picker in
    // the editor, and everyone else must not be offered a choice that would 403 on save. The
    // same two facts decide which rows get an עריכה button, and deriving them client-side
    // from the entry list is not possible — `scope: 'mine'` rows are already filtered to the
    // caller, so the list alone cannot say whether the canon rows are theirs to touch.
    return NextResponse.json({
      entries,
      viewer: {
        athleteId: caller.athleteId ?? null,
        isManager: caller.isSuperUser || caller.role === 'admin',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to read the library' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }
    // Not `caller.athleteId ?? null`: an entry with no author is an orphan on a shelf
    // nobody owns, and `owner_id` is what makes `scope: 'mine'` mean anything.
    if (!caller.athleteId) {
      return NextResponse.json({ error: 'Only a coach with an athlete record may write to the book' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || '').trim();
    if (!name) return NextResponse.json({ error: 'A workout needs a name' }, { status: 400 });
    if (!isLibraryKind(body?.kind)) return NextResponse.json({ error: 'Unknown workout kind' }, { status: 400 });

    const scope = isLibraryScope(body?.scope) ? body.scope : 'mine';
    const isManager = caller.isSuperUser || caller.role === 'admin';
    if (scope === 'academy' && !isManager) {
      return NextResponse.json({ error: 'Only a manager may write to the academy book' }, { status: 403 });
    }

    const checked = validateSteps(body?.steps);
    if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('academy_workout_library')
      .insert({
        scope,
        owner_id: caller.athleteId,
        name,
        kind: body.kind,
        notes: String(body?.notes || '').trim() || null,
        steps: checked.steps,
      })
      .select(COLUMNS)
      .single();

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP, { status: 503 });
      // The unique index. Said in the coach's terms rather than as a constraint name: the
      // realistic cause is saving the same session twice, one tap apart.
      if (String((error as any).code) === '23505') {
        return NextResponse.json({ error: 'A workout by that name is already on this shelf' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to save the workout' }, { status: 500 });
    }

    return NextResponse.json({ entry: toEntry(data) });
  } catch {
    return NextResponse.json({ error: 'Failed to save the workout' }, { status: 500 });
  }
}

/**
 * Edit, archive, or record that an entry was pushed.
 *
 *   { id, action: 'edit', name?, kind?, notes?, steps? }
 *   { id, action: 'archive' }
 *   { id, action: 'used', trainees: 6 }
 *
 * `used` is a counter bump and not an edit, which is why it is the one action a coach may
 * perform on an entry they do not own: pushing from the canon is exactly what the canon is
 * for, and the count is what keeps the book ordered by what the academy actually runs.
 */
export async function PATCH(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '');
    const action = String(body?.action || 'edit');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: existing, error: readError } = await supabase
      .from('academy_workout_library')
      .select('id, scope, owner_id, use_count')
      .eq('id', id)
      .is('archived_at', null)
      .maybeSingle();

    if (readError) {
      if (isMissingTable(readError)) return NextResponse.json(NOT_SET_UP, { status: 503 });
      return NextResponse.json({ error: 'Failed to read the workout' }, { status: 500 });
    }
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const isManager = caller.isSuperUser || caller.role === 'admin';
    const isOwn = !!caller.athleteId && existing.owner_id === caller.athleteId;

    if (action === 'used') {
      // Clamped and capped: this is a client-supplied number that only ever goes up, and
      // the academy is 25 people. A bad or absent value counts as one push rather than
      // rejecting — the push already happened, and refusing to record it would leave the
      // book's ordering quietly wrong.
      const trainees = Number(body?.trainees);
      const add = Number.isFinite(trainees) ? Math.min(100, Math.max(1, Math.round(trainees))) : 1;
      const { error } = await supabase
        .from('academy_workout_library')
        .update({
          use_count: Number(existing.use_count || 0) + add,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) return NextResponse.json({ error: 'Failed to record the push' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // Everything below CHANGES the entry, so it needs the write permission the POST
    // handler documents: your own shelf, or the canon if you are a manager.
    const mayWrite = existing.scope === 'academy' ? isManager : isOwn || isManager;
    if (!mayWrite) {
      // 404 and not 403, matching the tests route: a coach must not learn from the
      // response that another coach's shelf holds an entry with this id.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (action === 'archive') {
      const { error } = await supabase
        .from('academy_workout_library')
        .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) return NextResponse.json({ error: 'Failed to archive the workout' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action !== 'edit') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body?.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name) return NextResponse.json({ error: 'A workout needs a name' }, { status: 400 });
      patch.name = name;
    }
    if (body?.kind !== undefined) {
      if (!isLibraryKind(body.kind)) return NextResponse.json({ error: 'Unknown workout kind' }, { status: 400 });
      patch.kind = body.kind;
    }
    if (body?.notes !== undefined) patch.notes = String(body.notes || '').trim() || null;
    if (body?.steps !== undefined) {
      const checked = validateSteps(body.steps);
      if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
      patch.steps = checked.steps;
    }

    const { data, error } = await supabase
      .from('academy_workout_library')
      .update(patch)
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error) {
      if (String((error as any).code) === '23505') {
        return NextResponse.json({ error: 'A workout by that name is already on this shelf' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to save the workout' }, { status: 500 });
    }

    return NextResponse.json({ entry: toEntry(data) });
  } catch {
    return NextResponse.json({ error: 'Failed to save the workout' }, { status: 500 });
  }
}
