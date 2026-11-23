import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, requireStaffCaller } from '@/lib/auth/self-or-staff';
import { notifyStaff } from '@/lib/notifications/staff';
import { moderationUnmigrated, unmigratedResponse, validateReport, UUID_RE } from '@/lib/moderation/blocks';

export const dynamic = 'force-dynamic';

/**
 * Content reports (App Store guideline 1.2, migration 203).
 *
 * POST  { targetType, targetId, authorId?, reason, note? } → 201 { id }   (any verified member)
 * GET   ?status=open|actioned|dismissed → { reports: [...] }               (staff)
 * PATCH { id, status: 'actioned'|'dismissed' } → { ok: true }              (staff)
 *
 * The reporter comes from the JWT, never the body. The reported author is never
 * notified and nothing here returns the reporter to anyone but staff. For a feed
 * item or comment the author is read from the row (the body's authorId is only a
 * hint for targets that live outside our DB: Stream chat messages, photos).
 * 503 while 203 is unapplied, so the client falls back to /api/feedback.
 */
const REASON_HE: Record<string, string> = { offensive: 'פוגעני', harassment: 'הטרדה', spam: 'ספאם', privacy: 'פרטיות', other: 'אחר' };

type Db = ReturnType<typeof createServerClient>;

async function resolveAuthor(db: Db, type: string, id: string, hint: string | null): Promise<string | null> {
  if (!UUID_RE.test(id)) return hint;
  if (type === 'feed_item') {
    const { data } = await db.from('feed_items').select('author_athlete_id').eq('id', id).maybeSingle();
    return (data as { author_athlete_id?: string | null } | null)?.author_athlete_id ?? hint;
  }
  if (type === 'comment') {
    const { data } = await db.from('feed_comments').select('athlete_id').eq('id', id).maybeSingle();
    return (data as { athlete_id?: string | null } | null)?.athlete_id ?? hint;
  }
  return hint;
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 403 });
    const body = await request.json().catch(() => null);
    const v = validateReport(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const input = v.value;

    const db = createServerClient();
    const authorId = await resolveAuthor(db, input.targetType, input.targetId, input.authorId).catch(() => input.authorId);
    const { data, error } = await db
      .from('content_reports')
      .insert({
        reporter_athlete_id: caller.athleteId,
        target_type: input.targetType,
        target_id: input.targetId,
        author_athlete_id: authorId,
        reason: input.reason,
        note: input.note,
        status: 'open',
      })
      .select('id')
      .single();
    if (moderationUnmigrated(error)) return unmigratedResponse();
    if (error) return NextResponse.json({ error: 'Failed to save report', details: error.message }, { status: 500 });

    const id = (data as { id: string }).id;
    // Staff only. The author is never told, and the copy names neither party.
    await notifyStaff({
      kind: 'content_report',
      url: `/dashboard/settings?report=${id}`,
      tag: `content-report-${id}`,
      category: 'management',
      actorAthleteId: caller.athleteId,
      copy: (locale) =>
        locale === 'en'
          ? { title: 'Content reported', body: `A ${input.targetType.replace(/_/g, ' ')} was reported (${input.reason}). Review within 24 hours.` }
          : { title: 'דיווח על תוכן', body: `דווח תוכן (${REASON_HE[input.reason]}) — לבדוק תוך 24 שעות.` },
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    console.error('[moderation/report] failed:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const status = new URL(request.url).searchParams.get('status') || 'open';
  if (!['open', 'actioned', 'dismissed'].includes(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  const db = createServerClient();
  const { data, error } = await db
    .from('content_reports')
    .select('id, reporter_athlete_id, target_type, target_id, author_athlete_id, reason, note, status, created_at, handled_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(200);
  if (moderationUnmigrated(error)) return unmigratedResponse();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data || [] });
}

export async function PATCH(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  if (typeof body?.id !== 'string' || !UUID_RE.test(body.id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!['actioned', 'dismissed'].includes(body?.status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  const db = createServerClient();
  const { data, error } = await db
    .from('content_reports')
    .update({ status: body.status, handled_at: new Date().toISOString(), handled_by: caller.athleteId })
    .eq('id', body.id)
    .select('id');
  if (moderationUnmigrated(error)) return unmigratedResponse();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
