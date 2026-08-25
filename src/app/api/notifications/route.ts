import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';
import { sendPushToSubscriptions, resolveAudience } from '@/lib/push';

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
export async function GET() {
  try {
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
    const body = await request.json();
    const { actorEmail, title_he, body_he } = body;

    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized to send notifications.' }, { status: 403 });
    }
    if (!title_he || !body_he) {
      return NextResponse.json({ error: 'title_he and body_he are required' }, { status: 400 });
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
      recur_interval: body.recur_interval || null,
      recur_unit: body.recur_unit || null,
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
      const sent = await sendPushToSubscriptions(subs, {
        title: row.title_he || row.title_en || 'Madregot',
        body: row.body_he || row.body_en || '',
        url: row.url,
        tag: `notif-${created.id}`,
        // Coach-composed general announcements are the "news" toggle — this
        // used to be unmutable by design; the athlete-facing ask was
        // explicitly to be able to turn general news on/off, so it's now a
        // normal category like everything else instead of forced-on.
        category: 'news',
        ...(row.image_url ? { icon: row.image_url, image: row.image_url } : {}),
      });
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
    const body = await request.json();
    const { id, actorEmail } = body;
    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

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
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const actorEmail = searchParams.get('actorEmail');
    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const supabase = createServerClient();
    const { error } = await supabase.from('scheduled_notifications').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
