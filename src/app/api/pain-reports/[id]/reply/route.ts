import { NextResponse } from 'next/server';
import { notifyAthlete } from '@/lib/push';
import { painReplyCopy } from '@/lib/notifications/copy';
import { loadPain } from '../load';

export const dynamic = 'force-dynamic';

// POST /api/pain-reports/[id]/reply {text} → scoped staff only. The runner gets
// `pain_reply` (category coach). Replying also counts as seen.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await loadPain(request, id, 'staff');
  if (l.res) return l.res;
  if (l.caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 2000) return NextResponse.json({ error: 'text required' }, { status: 400 });
  const sender = l.caller.athleteId ?? l.caller.email;
  const { data, error } = await l.db.from('pain_report_messages')
    .insert({ report_id: id, sender_id: sender, from_staff: true, body: text }).select('id, created_at').single();
  if (error) { console.error('[api/pain-reports/[id]/reply]', error); return NextResponse.json({ error: 'Failed to save' }, { status: 500 }); }
  const now = new Date().toISOString();
  if (!l.row.seen_at) await l.db.from('pain_reports').update({ seen_at: now, seen_by: sender }).eq('id', id);
  const { data: me } = l.caller.athleteId
    ? await l.db.from('athletes').select('name').eq('id', l.caller.athleteId).maybeSingle()
    : { data: null };
  await notifyAthlete({
    athleteId: l.row.athlete_id, kind: 'pain_reply', url: `/me/pain/${id}`, tag: `pain-reply-${id}`,
    category: 'coach', actorAthleteId: l.caller.athleteId,
    copy: (locale) => painReplyCopy(locale, { coachName: me?.name || 'המאמן', text }),
  }).catch(() => null);
  return NextResponse.json({ message: { id: data.id, createdAt: data.created_at, body: text, fromStaff: true } });
}
