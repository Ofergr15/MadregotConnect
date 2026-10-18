import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';
import { resolveAudience, sendPushLocalized } from '@/lib/push';
import { publishAnnouncement } from '@/lib/feed/announce';
import { audienceTargets, readAudience, splitMessage } from '@/lib/publish/model';
import { publishClubPost } from '@/lib/publish/server';

export const dynamic = 'force-dynamic';

// POST { text, imageUrl?, audience: { mode: all|groups|people, groupIds?, athleteIds? }, scheduleAt?, push }
//   -> { feedItemId? , notifications: n, sent }
//
// "לפרסם › הודעה" (mockup publish, C1). With the push: one scheduled_notifications row per
// audience target (everyone / each pack / each person), sent now or at `scheduleAt`, and the
// one feed post publishAnnouncement leaves (it folds the same text into one post). Without
// the push: the feed post alone, now.
export async function POST(request: Request) {
  const { denied, email } = await requireApprover(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof b?.text === 'string' ? b.text.trim().slice(0, 2000) : '';
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });
  const audience = readAudience(b?.audience);
  if (!audience) return NextResponse.json({ error: 'bad audience' }, { status: 400 });
  const imageUrl = typeof b?.imageUrl === 'string' && /^https:\/\//.test(b.imageUrl) ? b.imageUrl : null;
  const scheduleAt = typeof b?.scheduleAt === 'string' && !Number.isNaN(Date.parse(b.scheduleAt)) && Date.parse(b.scheduleAt) > Date.now() + 60000
    ? new Date(b.scheduleAt).toISOString() : null;
  const db = createServerClient();
  try {
    if (b?.push === false) {
      const id = await publishClubPost(db, { body: text, media: imageUrl ? [{ path: '', url: imageUrl, w: null, h: null }] : [], payload: { message: true } });
      return NextResponse.json({ feedItemId: id, notifications: 0, sent: 0 });
    }
    const { title, body } = splitMessage(text);
    let sent = 0; let rows = 0;
    for (const t of audienceTargets(audience)) {
      const row = {
        kind: 'custom', title_he: title, body_he: body, url: '/feed', image_url: imageUrl,
        audience_type: t.audience_type, audience_id: t.audience_id,
        schedule_type: scheduleAt ? 'once_at' : 'now', scheduled_at: scheduleAt,
        next_run_at: scheduleAt ?? new Date().toISOString(), status: 'scheduled', created_by: email,
      };
      const { data: created, error } = await db.from('scheduled_notifications').insert(row).select().single();
      if (error) throw error;
      rows++;
      if (scheduleAt) continue; // cron/notifications sends it and posts it then
      const subs = await resolveAudience(row.audience_type, row.audience_id);
      const r = await sendPushLocalized(subs, () => ({
        title, body, url: row.url, tag: `notif-${created.id}`, category: 'news',
        ...(imageUrl ? { icon: imageUrl, image: imageUrl } : {}),
      }));
      sent += r.sent;
      await db.from('scheduled_notifications').update({ status: 'sent', last_sent_at: new Date().toISOString(), sent_count: r.sent }).eq('id', created.id);
      await publishAnnouncement(db, created);
    }
    return NextResponse.json({ notifications: rows, sent, scheduled: !!scheduleAt });
  } catch (err) {
    console.error('[publish/message] failed:', err);
    return NextResponse.json({ error: 'Failed to publish' }, { status: 500 });
  }
}
