import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';
import { resolveAudience, sendPushLocalized } from '@/lib/push';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { CLUB_STORIES_KEY, pruneClubStories, readClubStories, untilFor, type ClubStory } from '@/lib/feed/club-stories';

export const dynamic = 'force-dynamic';

// POST { title, text, days, push } -> { id, until, sent }
//   "לפרסם › הודעה › עיגול מדרגות" (lib/feed/club-stories.ts). With `push`, everyone gets
//   it too, and the tap opens the feed, where the circle is.
// DELETE ?id= -> { ok }  Off the row now.
async function load(db: ReturnType<typeof createServerClient>) {
  const { data } = await db.from('app_settings').select('value').eq('key', CLUB_STORIES_KEY).maybeSingle();
  return readClubStories((data as { value?: string } | null)?.value);
}
async function save(db: ReturnType<typeof createServerClient>, list: ClubStory[]) {
  const { error } = await db.from('app_settings').upsert({ key: CLUB_STORIES_KEY, value: JSON.stringify(list) }, { onConflict: 'key' });
  if (error) throw error;
}

export async function POST(request: Request) {
  const { denied, email } = await requireApprover(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof b?.text === 'string' ? b.text.trim().slice(0, 1200) : '';
  const title = typeof b?.title === 'string' ? b.title.trim().slice(0, 80) : '';
  if (!text && !title) return NextResponse.json({ error: 'text required' }, { status: 400 });
  const days = Number(b?.days) || 1;
  const db = createServerClient();
  try {
    const today = israelToday();
    const story: ClubStory = {
      id: randomUUID(), title: title || 'מדרגות', text, from: today, until: untilFor(today, days),
      createdAt: new Date().toISOString(), createdBy: email ?? null,
    };
    await save(db, pruneClubStories([story, ...(await load(db))], today));
    let sent = 0;
    if (b?.push === true) {
      const subs = await resolveAudience('all', null);
      const r = await sendPushLocalized(subs, () => ({ title: story.title, body: story.text, url: '/feed', tag: `club-story-${story.id}`, category: 'news' }));
      sent = r.sent;
    }
    return NextResponse.json({ id: story.id, until: story.until, sent });
  } catch (err) {
    console.error('[club-stories] failed:', err);
    return NextResponse.json({ error: 'Failed to publish' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { denied } = await requireApprover(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const db = createServerClient();
  try {
    const today = israelToday();
    // Ended yesterday: off the row at once, and still listed as "ended" for a while.
    const yesterday = addDaysToDateStr(today, -1);
    const list = (await load(db)).map((s) => (s.id === id ? { ...s, until: yesterday } : s));
    await save(db, pruneClubStories(list, today));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[club-stories] delete failed:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
