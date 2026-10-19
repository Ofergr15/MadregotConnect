import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { notifyAthlete } from '@/lib/push';
import { SECTIONS, type Section } from '@/lib/week-setup/model';

export const dynamic = 'force-dynamic';

const LABEL: Record<Section, string> = { workouts: 'האימונים', nutrition: 'התזונה', quality: 'ימי האיכות', notifications: 'ההתראות', polls: 'הסקרים', message: 'ההודעה' };

// POST /api/week-setup/done { week, sections } — "סיימתי": the coach tells the admins their
// part of the week is ready. A push and an inbox row to every admin / super user but the sender.
export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const week = typeof body?.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.week) ? body.week : null;
  const sections = (Array.isArray(body?.sections) ? body.sections : []).filter((s: unknown): s is Section => SECTIONS.includes(s as Section));
  if (!week || sections.length === 0) return NextResponse.json({ error: 'week and sections are required' }, { status: 400 });
  const supabase = createServerClient();
  const { data: me } = caller.athleteId ? await supabase.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle() : { data: null };
  const { data: admins } = await supabase.from('athletes').select('id').or('role.eq.admin,is_super_user.eq.true');
  const what = sections.map((s: Section) => LABEL[s]).join(' ו');
  let sent = 0;
  for (const a of (admins ?? []).filter((x: { id: string }) => x.id !== caller.athleteId)) {
    const r = await notifyAthlete({
      athleteId: a.id, kind: 'week_setup_done', actorAthleteId: caller.athleteId, url: `/dashboard/week?week=${week}`, category: 'management',
      title: `${me?.name || 'המאמן'}: ${what} לשבוע מוכנים ✅`, body: 'פותחים את "תחילת שבוע" ומשלימים את השאר',
    }).catch(() => null);
    sent += r?.delivered ?? 0;
  }
  return NextResponse.json({ ok: true, sent });
}
