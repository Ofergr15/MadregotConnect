import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendPushLocalized, resolveAudience } from '@/lib/push';
import { pickBilingual } from '@/lib/notifications/copy';
import { requireApprover } from '@/lib/auth/require-approver';

export const dynamic = 'force-dynamic';

// Compute the initial next_run_at from the schedule fields.
function computeNextRun(body: any): string | null {
  if (body.schedule_type === 'now') return new Date().toISOString();
  if (body.schedule_type === 'once_at' || body.schedule_type === 'recurring') {
    return body.scheduled_at ? new Date(body.scheduled_at).toISOString() : new Date().toISOString();
  }
  return null;
}

// GET /api/notifications — list scheduled + sent (admin).
export async function GET(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('scheduled_notifications')
      .select('*')
      .eq('kind', 'custom')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ notifications: data || [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/notifications — create (and, for schedule_type 'now', send immediately).
export async function POST(request: Request) {
  try {
    const { denied, email: actorEmail } = await requireApprover(request);
    if (denied) return denied;

    const body = await request.json();
    const { title_he, body_he } = body;

    if (!title_he || !body_he) {
      return NextResponse.json({ error: 'title_he and body_he are required' }, { status: 400 });
    }
    // A non-positive interval never advances forward (cron/notifications'
    // `advance()` would move next_run_at backward or leave it stuck), which
    // makes it due on every tick forever — a runaway re-send to the whole
    // audience with nothing to stop it short of an admin noticing and
    // cancelling the row by hand.
    if (body.schedule_type === 'recurring' && (!Number.isInteger(body.recur_interval) || body.recur_interval < 1)) {
      return NextResponse.json({ error: 'Recurring interval must be a whole number ≥ 1' }, { status: 400 });
    }

    const supabase = createServerClient();
    const row = {
      kind: 'custom',
      title_he,
      body_he,
      title_en: body.title_en || null,
      body_en: body.body_en || null,
      url: body.url || '/dashboard',
      image_url: body.image_url || null,
      audience_type: body.audience_type || 'all',
      audience_id: body.audience_id || null,
      schedule_type: body.schedule_type || 'now',
      scheduled_at: body.scheduled_at || null,
      recur_interval: body.schedule_type === 'recurring' ? body.recur_interval : null,
      recur_unit: body.schedule_type === 'recurring' ? (body.recur_unit || null) : null,
      next_run_at: computeNextRun(body),
      status: 'scheduled',
      created_by: actorEmail,
    };

    let { data: created, error } = await supabase
      .from('scheduled_notifications')
      .insert(row)
      .select()
      .single();
    if (error?.code === '42703' || error?.code === 'PGRST204') {
      // image_url not migrated yet — retry without it rather than failing
      // every broadcast over one missing column.
      const { image_url, ...rowWithoutImage } = row;
      ({ data: created, error } = await supabase
        .from('scheduled_notifications')
        .insert(rowWithoutImage)
        .select()
        .single());
    }
    if (error) throw error;
    if (!created) return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });

    // Send-now: deliver immediately and mark sent, rather than waiting for the
    // scanner cron's next tick.
    if (row.schedule_type === 'now') {
      const subs = await resolveAudience(row.audience_type, row.audience_id);
      // Each recipient gets the column they can read. This used to be
      // `title_he || title_en`, which meant an admin who filled in BOTH
      // languages still only ever reached Hebrew.
      const { sent } = await sendPushLocalized(subs, (locale) => ({
        title: pickBilingual(locale, { he: row.title_he, en: row.title_en }) || 'Madregot',
        body: pickBilingual(locale, { he: row.body_he, en: row.body_en }),
        url: row.url,
        tag: `notif-${created.id}`,
        // Coach-composed general announcements are the "news" toggle — this
        // used to be unmutable by design; the athlete-facing ask was
        // explicitly to be able to turn general news on/off, so it's now a
        // normal category like everything else instead of forced-on.
        category: 'news',
        ...(row.image_url ? { icon: row.image_url, image: row.image_url } : {}),
      }));
      await supabase
        .from('scheduled_notifications')
        .update({ status: 'sent', last_sent_at: new Date().toISOString(), sent_count: sent })
        .eq('id', created.id);
      return NextResponse.json({ notification: { ...created, status: 'sent', sent_count: sent }, sent });
    }

    return NextResponse.json({ notification: created });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PUT /api/notifications — edit a scheduled notification, or cancel it.
export async function PUT(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;

    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    // Same runaway-recurrence guard as POST — see the comment there.
    const effectiveScheduleType = body.schedule_type ?? body.scheduleType;
    if (
      (effectiveScheduleType === 'recurring' || ('recur_interval' in body && effectiveScheduleType === undefined))
      && 'recur_interval' in body
      && (!Number.isInteger(body.recur_interval) || body.recur_interval < 1)
    ) {
      return NextResponse.json({ error: 'Recurring interval must be a whole number ≥ 1' }, { status: 400 });
    }

    const supabase = createServerClient();
    const update: any = { updated_at: new Date().toISOString() };
    for (const k of ['title_he', 'body_he', 'title_en', 'body_en', 'url', 'image_url', 'audience_type', 'audience_id', 'schedule_type', 'scheduled_at', 'recur_interval', 'recur_unit', 'status']) {
      if (k in body) update[k] = body[k];
    }
    if ('scheduled_at' in body || 'schedule_type' in body) {
      update.next_run_at = computeNextRun({ ...body });
    }

    let { data, error } = await supabase
      .from('scheduled_notifications')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if ((error?.code === '42703' || error?.code === 'PGRST204') && 'image_url' in update) {
      const { image_url, ...updateWithoutImage } = update;
      ({ data, error } = await supabase
        .from('scheduled_notifications')
        .update(updateWithoutImage)
        .eq('id', id)
        .select()
        .single());
    }
    if (error) throw error;
    return NextResponse.json({ notification: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/notifications?id=… — remove a notification.
export async function DELETE(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const supabase = createServerClient();
    const { error } = await supabase.from('scheduled_notifications').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
