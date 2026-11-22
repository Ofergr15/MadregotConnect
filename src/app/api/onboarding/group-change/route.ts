import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { notifyStaff } from '@/lib/notifications/staff';
import { groupDisplayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/group-change — the caller asks to move pack (BUILD-BRIEF gap 4).
 *   { toGroupId, note? } → { ok, request: { id, status: 'pending', toGroupId } }
 *
 * A REQUEST, never a switch: group_id is untouched until staff decide
 * (POST /api/admin/group-change-requests). Self only, from the verified JWT. One open
 * request per athlete — asking again retargets it. Staff hear it through the routed
 * kind `group_change_request` (falls back to admin-only, like every routed kind).
 * Pre-189 → 503 not-ready, and the app offers WhatsApp to the team instead.
 */
export async function POST(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId || caller.viewingAsBy) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { toGroupId?: unknown; note?: unknown };
  const toGroupId = typeof body.toGroupId === 'string' ? body.toGroupId : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 280) || null : null;
  try {
    const supabase = createServerClient();
    const { data: group } = await supabase.from('groups').select('id, name').eq('id', toGroupId).eq('coach_id', COACH_ID).maybeSingle();
    if (!group) return NextResponse.json({ error: 'bad-group' }, { status: 400 });
    const { data: me } = await supabase.from('athletes').select('id, name, group_id').eq('id', caller.athleteId).maybeSingle();
    if (!me) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (me.group_id === group.id) return NextResponse.json({ error: 'same-group' }, { status: 400 });

    const { data: open, error: readError } = await supabase
      .from('group_change_requests').select('id').eq('athlete_id', me.id).eq('status', 'pending').maybeSingle();
    if (readError && (readError.code === '42P01' || readError.code === 'PGRST205')) return NextResponse.json({ error: 'not-ready' }, { status: 503 });
    const write = { athlete_id: me.id, from_group_id: me.group_id ?? null, to_group_id: group.id, note };
    const { data: saved, error } = open
      ? await supabase.from('group_change_requests').update(write).eq('id', open.id).select('id').single()
      : await supabase.from('group_change_requests').insert(write).select('id').single();
    if (error) throw error;

    const to = groupDisplayName(group.name);
    await notifyStaff({
      kind: 'group_change_request',
      url: '/dashboard/entry-queue?at=mine',
      tag: `group-change-${me.id}`,
      category: 'management',
      actorAthleteId: me.id,
      copy: (locale) => locale === 'he'
        ? { title: `${me.name || 'רץ'} מבקש/ת לעבור ל${to}`, body: note || 'מההגדרה הראשונה באפליקציה. ההחלטה אצלכם.' }
        : { title: `${me.name || 'A runner'} asked to move to ${to}`, body: note || 'From first-run setup in the app. Your call.' },
    });
    return NextResponse.json({ ok: true, request: { id: saved.id, status: 'pending', toGroupId: group.id } });
  } catch (err) {
    console.error('[onboarding/group-change] failed:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
