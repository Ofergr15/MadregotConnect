import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireContentLevel } from '@/lib/access/require-content';
import { COACH_ID } from '@/lib/constants';
import { shapePostResults } from '@/lib/content/hub';
import { recentPublished } from '@/lib/publish/server';

export const dynamic = 'force-dynamic';

// GET /api/admin/content/post?id= — ONE post's results (mockup content-v4, 3): who
// liked it, how many phones its push reached, a survey's votes, and who hasn't
// opened the app since it went up. There is no per-post view count (that would need
// a table the app doesn't have), so "didn't open since" is all that is claimed.

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(request: Request) {
  // Any part of Content opens a post's page (its own part is checked by the hub's list).
  const { denied } = await requireContentLevel(request, null, 1, (u) => u.isSuperUser || u.isStaff);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const db = createServerClient();
  try {
    const { data: item } = await db.from('feed_items').select('id, body, payload, media, occurred_at, comment_count, author_athlete_id, type')
      .eq('id', id).is('deleted_at', null).maybeSingle();
    const row = item as { id: string; body: string | null; payload: Record<string, unknown> | null; media: Array<{ url?: string }> | null; occurred_at: string; comment_count: number | null; author_athlete_id: string | null; type: string } | null;
    if (!row || row.type !== 'announcement' || row.author_athlete_id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const surveyId = typeof row.payload?.surveyId === 'string' ? row.payload.surveyId : null;
    const [{ data: likes }, { data: people }, survey, summary] = await Promise.all([
      db.from('feed_likes').select('athlete_id').eq('feed_item_id', id),
      db.from('athletes').select('id, name, last_seen_at').eq('coach_id', COACH_ID).eq('status', 'active'),
      surveyId
        ? Promise.all([
          db.from('surveys').select('options_he').eq('id', surveyId).maybeSingle(),
          db.from('survey_responses').select('option_index, athlete_id').eq('survey_id', surveyId),
        ])
        : Promise.resolve(null),
      // The same row the hub shows, so the header and the "delivered" number match it.
      recentPublished(db, 60).then((list) => list.find((p) => p.id === id) ?? null).catch(() => null),
    ]);
    const results = shapePostResults({
      postedAt: row.occurred_at,
      likerIds: ((likes || []) as Array<{ athlete_id: string }>).map((l) => l.athlete_id),
      comments: row.comment_count ?? 0,
      delivered: summary?.delivered ?? null,
      members: ((people || []) as Array<{ id: string; name: string | null; last_seen_at: string | null }>).map((p) => ({ id: p.id, name: p.name || '', lastSeenAt: p.last_seen_at })),
      survey: survey ? {
        options: ((survey[0].data as { options_he?: string[] } | null)?.options_he) ?? [],
        responses: ((survey[1].data || []) as Array<{ option_index: number }>).map((r) => r.option_index),
        voters: new Set(((survey[1].data || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id)).size,
      } : null,
    });
    return NextResponse.json({
      post: {
        id: row.id, at: row.occurred_at,
        kind: summary?.kind ?? (surveyId ? 'survey' : 'message'),
        text: summary?.text ?? (row.body || '').split('\n')[0].slice(0, 70),
        emoji: summary?.emoji ?? '📣',
        image: row.media?.[0]?.url ?? null,
        photos: row.media?.length ?? 0,
      },
      results,
    });
  } catch (err) {
    console.error('[admin/content/post] failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
