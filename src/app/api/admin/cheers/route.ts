import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';
import { COACH_ID } from '@/lib/constants';
import { resolveAudience, sendPushLocalized } from '@/lib/push';
import { CHEER_REASONS, plainText, type CheerReason } from '@/lib/publish/model';
import { publishClubPost } from '@/lib/publish/server';

export const dynamic = 'force-dynamic';

// POST { athleteId, reason, text, push } -> { feedItemId, sent }
//
// "לפרסם › ברכה / הישג" (mockup publish, C2): a club post on the feed tagging the person.
// Likes and comments reach them like on their own post (lib/feed/notify.ts, payload.honoreeId).
// The push to the club is optional.
export async function POST(request: Request) {
  const { denied } = await requireApprover(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const athleteId = typeof b?.athleteId === 'string' && /^[0-9a-f-]{36}$/i.test(b.athleteId) ? b.athleteId : '';
  const reason = (CHEER_REASONS as readonly string[]).includes(b?.reason as string) ? (b!.reason as CheerReason) : 'other';
  const text = typeof b?.text === 'string' ? b.text.trim().slice(0, 1000) : '';
  if (!athleteId || !text) return NextResponse.json({ error: 'athleteId and text required' }, { status: 400 });
  const db = createServerClient();
  try {
    const { data: who } = await db.from('athletes').select('id, name').eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
    if (!who) return NextResponse.json({ error: 'not a member' }, { status: 404 });
    const id = await publishClubPost(db, { body: text, payload: { cheerFor: athleteId, honoreeId: athleteId, reason } });
    let sent = 0;
    if (b?.push === true && id) {
      const subs = await resolveAudience('all', null);
      const r = await sendPushLocalized(subs, () => ({
        title: `🏅 מגיע ל־${(who as { name: string }).name.split(' ')[0]} ברכה`,
        body: plainText(text).slice(0, 160), url: `/feed?item=${id}`, tag: `cheer-${id}`, category: 'teammates',
      }));
      sent = r.sent;
    }
    return NextResponse.json({ feedItemId: id, sent });
  } catch (err) {
    console.error('[cheers] failed:', err);
    return NextResponse.json({ error: 'Failed to publish' }, { status: 500 });
  }
}
