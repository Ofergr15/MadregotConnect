import { invalidateShared, SHARED_TAGS } from '@/lib/cache/shared';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { isMissingSchema, publishPatch, type PublishMode } from '@/lib/events/lifecycle';
import { replaceBlocks } from '@/lib/events/server';
import { resolveAudience, sendPushLocalized } from '@/lib/push';
import { newEventCopy } from '@/lib/notifications/copy';
import { rebalanceWaitlist } from '@/lib/events/rsvp-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/events/[id]/publish — staff only.
 * Body: { mode: 'now' | 'schedule', publishAt?: ISO, notify?: boolean }
 *  - draft → now: goes live; `notify` pushes the club the same "new event" push POST
 *    /api/events always sent.
 *  - draft → schedule: goes live at publishAt (evaluated on read). `notify` is NOT
 *    honoured for scheduled publishes yet — there is no job that fires at publishAt.
 *  - published with a pending version → now: the pending version goes live, version+1;
 *    `notify` pushes an update.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const mode: PublishMode = body?.mode === 'schedule' ? 'schedule' : 'now';
    const supabase = createServerClient();
    const { data: row, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (!('status' in row)) return NextResponse.json({ error: 'Publishing needs migration 184' }, { status: 409 });

    const now = new Date();
    const res = publishPatch(row, mode, body?.publishAt, now);
    if ('error' in res) return NextResponse.json({ error: res.error }, { status: 400 });

    if (res.blocks) await replaceBlocks(supabase, id, res.blocks);
    const { data, error: upErr } = await supabase
      .from('events')
      .update({ ...res.patch, updated_at: now.toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    invalidateShared(SHARED_TAGS.events);
    if (upErr) {
      if (isMissingSchema(upErr)) return NextResponse.json({ error: 'Publishing needs migration 184' }, { status: 409 });
      throw upErr;
    }
    // Publishing a pending edit can change the capacity: fill any freed spots.
    if (data && res.patch && 'capacity' in (res.patch as Record<string, unknown>)) {
      try { await rebalanceWaitlist(supabase, id, data.capacity ?? null); } catch (e) { console.error('event waitlist rebalance failed:', e); }
    }

    let notified = 0;
    if (body?.notify === true && res.kind !== 'schedule') {
      try {
        const subs = await resolveAudience('all', null);
        if (subs.length > 0) {
          const r = await sendPushLocalized(subs, (locale) => ({
            ...newEventCopy(locale, { kind: data.kind, name: data.name, date: data.date }),
            url: `/dashboard/calendar/${id}`,
            tag: `event-${id}-v${data.version ?? 1}`,
            category: 'events',
          }));
          notified = (r as { sent?: number })?.sent ?? 0;
        }
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ event: data, kind: res.kind, notified });
  } catch (error) {
    console.error('Failed to publish event:', error);
    return NextResponse.json({ error: 'Failed to publish event' }, { status: 500 });
  }
}
