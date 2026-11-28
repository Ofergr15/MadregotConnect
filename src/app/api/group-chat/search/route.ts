import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient, CHANNEL_TYPE } from '@/lib/stream/server';
import { groupChannelId, groupChatMembers } from '@/lib/group-chat/server';
import { mayEnter } from '@/lib/group-chat/logic';
import { cleanCursor, cleanQuery, pageSize, toHits } from '@/lib/group-chat/search';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/group-chat/search?groupId=&q=&limit=&next= → { hits, next } — full-text search inside
 * ONE group's chat (task 88). Member-gated exactly like opening the chat (mayEnter): a caller
 * who can't sit in the room can't search it. The Stream query is pinned to that one channel's
 * cid, so a search can never return another group's messages; results are re-checked anyway.
 * Paginated with Stream's opaque cursor (`next`).
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const sp = new URL(request.url).searchParams;
    const groupId = (sp.get('groupId') || '').trim();
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400, headers: NO_STORE });
    const q = cleanQuery(sp.get('q'));
    if (!q) return NextResponse.json({ error: 'q must be 2–100 characters' }, { status: 400, headers: NO_STORE });

    const members = await groupChatMembers(createServerClient(), groupId);
    if (!members) return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
    if (!mayEnter(caller, members)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });

    const cid = `${CHANNEL_TYPE}:${groupChannelId(groupId)}`;
    const next = cleanCursor(sp.get('next'));
    try {
      const res = await getStreamServerClient().search(
        { cid },
        q,
        { limit: pageSize(sp.get('limit')), ...(next ? { next } : {}), sort: [{ created_at: -1 }] },
      );
      return NextResponse.json({ hits: toHits(res.results as never, cid), next: res.next ?? null }, { headers: NO_STORE });
    } catch (err) {
      // No channel yet → nothing to find. Anything else is Stream being down.
      const msg = String(err);
      if (/not.?found|does not exist/i.test(msg)) return NextResponse.json({ hits: [], next: null }, { headers: NO_STORE });
      console.error('GET /api/group-chat/search — Stream error:', err);
      return NextResponse.json({ error: 'search unavailable' }, { status: 503, headers: NO_STORE });
    }
  } catch (err: unknown) {
    console.error('GET /api/group-chat/search error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500, headers: NO_STORE });
  }
}
