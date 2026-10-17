import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { SESSION_PHOTOS_KIND, SESSION_PHOTOS_TOP_HOURS } from '@/lib/quality-session/photos';

export const dynamic = 'force-dynamic';

// GET /api/feed/session-photos -> { id: string | null }
//   The quality session's photos card while it belongs at the TOP of the feed
//   (Ofer, 2026-10-17: "at the top, after the workout, once there's a link"): the
//   newest one published in the last SESSION_PHOTOS_TOP_HOURS. Just the id — the
//   page loads the card through /api/feed/items/[id] like a focused item, so its
//   likes and comments come with it. Any member: the card is the club's.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const since = new Date(Date.now() - SESSION_PHOTOS_TOP_HOURS * 3_600_000).toISOString();
  const { data, error } = await createServerClient()
    .from('feed_items')
    .select('id')
    .eq('type', 'announcement')
    .eq('payload->>kind', SESSION_PHOTOS_KIND)
    .is('deleted_at', null)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) return NextResponse.json({ id: null });
  return NextResponse.json({ id: data?.id ?? null });
}
