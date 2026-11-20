import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { EVENT_KINDS, isCourseGpxUrl, isEventKind } from '@/lib/events';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

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
] as const;

// GET /api/events/[id] — single event; powers the dedicated event detail
// page (#8). No auth required, same public-read convention as GET /api/events.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = createServerClient();
    const { data, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    return NextResponse.json({ event: data });
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
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      if (updates.course_gpx_url !== undefined && isMissingColumn(error)) {
        return NextResponse.json({ error: 'migration 181 not applied' }, { status: 503 });
      }
      throw error;
    }
    if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    return NextResponse.json({ event: data });
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

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete event:', error);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
