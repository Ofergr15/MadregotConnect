import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requirePackLeader } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { daysSinceRun, loadPack, packMembers, packSession, planPublishedAt } from '@/lib/packs/server';
import { forLeader } from '@/lib/packs/leader-safe';
import { toMoment } from '@/lib/packs/moments';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/packs/:id/home — the leader's home: today's session, who read the plan, days since
 * each member's last run, and the pack's moments. Leader of THIS pack or staff
 * (`requirePackLeader`). Never a verdict, HR or pain: the response goes through `forLeader`.
 *
 * `readPlan` = the member opened the app (athletes.last_seen_at) after this week's group plan
 * was published — there is no per-plan read receipt.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { denied } = await requirePackLeader(request, id);
    if (denied) return denied;
    const db = createServerClient();
    const pack = await loadPack(db, id);
    if (!pack) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const today = israelToday();
    const [members, session, publishedAt, { data: moments }] = await Promise.all([
      packMembers(db, id),
      packSession(db, today, pack.groupIndex),
      planPublishedAt(db, today),
      db.from('pack_moments').select('id, kind, body, send_at, sent_at, ready_by').eq('pack_id', id)
        .order('send_at', { ascending: true, nullsFirst: false }).limit(50),
    ]);
    const since = await daysSinceRun(db, members.map((m) => m.athleteId), today);
    const rows = members.map((m) => ({
      athleteId: m.athleteId, name: m.name, avatarUrl: m.avatarUrl,
      readPlan: !!publishedAt && !!m.lastSeenAt && m.lastSeenAt >= publishedAt,
      daysSinceRun: since.get(m.athleteId) ?? null,
    }));
    return NextResponse.json(forLeader({
      today: session ? { date: session.date, title: session.title, paceText: session.paceText, time: session.time, place: session.place } : null,
      readCount: rows.filter((r) => r.readPlan).length,
      memberCount: rows.length,
      members: rows,
      moments: ((moments || []) as any[]).map(toMoment),
    }));
  } catch (err: any) {
    console.error('GET /api/packs/[id]/home error:', err);
    return NextResponse.json(internalErrorBody('failed'), { status: 500 });
  }
}
