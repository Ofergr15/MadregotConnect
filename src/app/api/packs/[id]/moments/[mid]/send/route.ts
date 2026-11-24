import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requirePackLeader } from '@/lib/auth/self-or-staff';
import { forLeader } from '@/lib/packs/leader-safe';
import { toMoment } from '@/lib/packs/moments';
import { packChannelId } from '@/lib/packs/server';
import { CHANNEL_TYPE, getStreamServerClient } from '@/lib/stream/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/packs/:id/moments/:mid/send — a person presses send; nothing sends on its own.
 * Claims `sent_at` atomically (WHERE sent_at IS NULL) so a double tap sends once, then posts
 * the body into the pack chat, best-effort (a Stream outage leaves the moment marked sent and
 * says `posted: false`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; mid: string }> }) {
  try {
    const { id, mid } = await params;
    const { denied, caller } = await requirePackLeader(request, id);
    if (denied) return denied;
    if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
    const db = createServerClient();
    const { data: claimed, error } = await db.from('pack_moments')
      .update({ sent_at: new Date().toISOString(), sent_by: caller.athleteId })
      .eq('id', mid).eq('pack_id', id).is('sent_at', null)
      .select('id, kind, body, send_at, sent_at, ready_by').maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!claimed) {
      const { data: existing } = await db.from('pack_moments').select('id, kind, body, send_at, sent_at, ready_by')
        .eq('id', mid).eq('pack_id', id).maybeSingle();
      if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(forLeader({ moment: toMoment(existing), alreadySent: true }));
    }
    let posted = false;
    if (caller.athleteId && claimed.body) {
      try {
        const stream = getStreamServerClient();
        await stream.channel(CHANNEL_TYPE, packChannelId(id)).sendMessage({ text: claimed.body, user_id: caller.athleteId } as never);
        posted = true;
      } catch (err) {
        console.warn('pack moment: Stream post failed', err);
      }
    }
    return NextResponse.json(forLeader({ moment: toMoment(claimed), posted }));
  } catch (err: any) {
    console.error('POST /api/packs/[id]/moments/[mid]/send error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
