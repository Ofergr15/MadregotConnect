import { invalidateShared, SHARED_TAGS } from '@/lib/cache/shared';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { EVENT_KINDS, isCourseGpxUrl, isEventKind } from '@/lib/events';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import {
  editTarget, isMissingSchema, mergePending, normaliseBlocks, projectEvent, visibleBlocks, isVisibleTo,
} from '@/lib/events/lifecycle';
import { callerIsStaff, loadBlocks, optionalCaller, replaceBlocks } from '@/lib/events/server';
import { rebalanceWaitlist } from '@/lib/events/rsvp-server';
import { withSchedule } from '@/lib/events/schedule';

export const dynamic = 'force-dynamic';

// Columns an authenticated staff caller may change via PATCH. `id`,
// `created_by`, `created_at`, `updated_at` are server-managed and excluded.
const UPDATABLE_FIELDS = [
  'kind',
  'name',
  'description',
  'date',
  'end_date',
  'start_time',
  'location',
  'lat',
  'lng',
  'waze_url',
  'distances',
  'race_class',
  'website',
  'agenda',
  'gear',
  'faqs',
  'capacity',
  'registration_deadline',
  'course_gpx_url',
  'cover_image_url',
  'logo_url',
] as const;

// GET /api/events/[id] — single event. The row stays public for a PUBLISHED event
// (the pre-v2 convention); a draft / not-yet-live scheduled one is staff-only and
// reads as 404 to anyone else. `blocks` (v2) are returned only to a verified
// member — club_runners, questionnaire etc. are club-internal — and members get
// enabled blocks only. Staff may pass ?pending=1 to read the pending version.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = createServerClient();
    const { data, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    const caller = await optionalCaller(request);
    const staff = callerIsStaff(caller);
    const now = new Date();
    if (!data || !isVisibleTo(data, staff, now)) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    let event = projectEvent(data, staff, now) as Record<string, unknown>;
    let blocks = caller ? visibleBlocks(await loadBlocks(supabase, id), staff) : null;
    const wantPending = new URL(request.url).searchParams.get('pending') === '1';
    if (staff && wantPending && data.pending) {
      const p = data.pending as { fields?: Record<string, unknown>; blocks?: typeof blocks };
      event = { ...event, ...(p.fields ?? {}) };
      if (p.blocks) blocks = p.blocks;
    }
    return NextResponse.json({ event: withSchedule(event), blocks });
  } catch (error) {
    console.error('Failed to fetch event:', error);
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 });
  }
}

// PATCH /api/events/[id] — staff-only partial update. Body: any subset of
// UPDATABLE_FIELDS.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff && !auth.user.isSuperUser) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    if (body?.kind !== undefined && !isEventKind(body.kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${EVENT_KINDS.join(', ')}` },
        { status: 400 },
      );
    }

    if (body?.course_gpx_url !== undefined && !isCourseGpxUrl(body.course_gpx_url)) {
      return NextResponse.json({ error: 'course_gpx_url must be an https URL or null' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (body?.[field] !== undefined) updates[field] = body[field];
    }
    const blocks = body?.blocks !== undefined ? normaliseBlocks(body.blocks) : null;
    if (body?.blocks !== undefined && blocks === null) {
      return NextResponse.json({ error: 'blocks must be an array' }, { status: 400 });
    }
    if (Object.keys(updates).length === 0 && !blocks) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: current, error: curErr } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
    if (curErr) throw curErr;
    if (!current) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    // v2: an edit to a LIVE event becomes a pending version (goes live on
    // POST /api/events/[id]/publish); a draft is edited in place.
    if (editTarget(current, new Date()) === 'pending') {
      const pending = mergePending(current.pending, { fields: updates, ...(blocks ? { blocks } : {}) });
      const { data, error } = await supabase
        .from('events')
        .update({ pending, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle();
      invalidateShared(SHARED_TAGS.events);
      if (error) throw error;
      return NextResponse.json({ event: data, pending: true });
    }

    if (blocks) {
      try { await replaceBlocks(supabase, id, blocks); } catch (e) {
        if (!isMissingSchema(e as { message?: string })) throw e;
        return NextResponse.json({ error: 'Blocks need migration 184' }, { status: 409 });
      }
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ event: current, pending: false });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();
    invalidateShared(SHARED_TAGS.events);

    if (error) {
      if (updates.course_gpx_url !== undefined && isMissingColumn(error)) {
        return NextResponse.json({ error: 'migration 200 not applied' }, { status: 503 });
      }
      throw error;
    }
    if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    // A capacity edit frees (or removes the limit on) spots: fill them from the waitlist.
    if ('capacity' in updates) {
      try { await rebalanceWaitlist(supabase, id, data.capacity ?? null); } catch (e) { console.error('event waitlist rebalance failed:', e); }
    }

    return NextResponse.json({ event: data, pending: false });
  } catch (error) {
    console.error('Failed to update event:', error);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

// DELETE /api/events/[id] — staff-only. `event_registrations` rows cascade
// via the FK in the migration, so no manual cleanup is needed here.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff && !auth.user.isSuperUser) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('events')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    invalidateShared(SHARED_TAGS.events);

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete event:', error);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
