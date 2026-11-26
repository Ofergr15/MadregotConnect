import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, requireStaffCaller } from '@/lib/auth/self-or-staff';
import { notifyStaff } from '@/lib/notifications/staff';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { moderationUnmigrated, unmigratedResponse, validateReport, UUID_RE } from '@/lib/moderation/blocks';

export const dynamic = 'force-dynamic';

/**
 * Content reports (App Store guideline 1.2, migration 203; author_verified in 220).
 *
 * POST  { targetType, targetId, authorId?, reason, note? } → 201 { id }   (any verified member)
 * GET   ?status=open|actioned|dismissed → { reports: [...] }               (staff)
 * PATCH { id, status: 'actioned'|'dismissed' } → { ok: true }              (staff)
 *
 * The reporter comes from the JWT, never the body. The reported author is never
 * notified and nothing here returns the reporter to anyone but staff. For a feed
 * item or comment the author is read from the row; for targets that live outside
 * our DB (Stream chat / academy thread messages, Drive photos) the body's authorId
 * is kept as a hint with author_verified = false.
 *
 * Abuse limits (QA 25.11 #5): one report per (reporter, target) — a repeat answers
 * 201 with the existing id; at most REPORTS_PER_HOUR per reporter (429); staff are
 * pushed once per open target, not once per report.
 * 503 while 203 is unapplied, so the client falls back to /api/feedback.
 */
const REASON_HE: Record<string, string> = { offensive: 'פוגעני', harassment: 'הטרדה', spam: 'ספאם', privacy: 'פרטיות', other: 'אחר' };

/** Reports one member may file in a rolling hour before the route answers 429. */
const REPORTS_PER_HOUR = 10;

type Db = ReturnType<typeof createServerClient>;

async function resolveAuthor(db: Db, type: string, id: string, hint: string | null): Promise<{ authorId: string | null; verified: boolean }> {
  const src = type === 'feed_item' ? { t: 'feed_items', c: 'author_athlete_id' } : type === 'comment' ? { t: 'feed_comments', c: 'athlete_id' } : null;
  if (!src || !UUID_RE.test(id)) return { authorId: hint, verified: false };
  const { data, error } = await db.from(src.t).select(src.c).eq('id', id).maybeSingle();
  const found = (data as Record<string, string | null> | null)?.[src.c] ?? null;
  if (error || !found) return { authorId: hint, verified: false };
  return { authorId: found, verified: true };
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

    // 1. Same reporter, same target → the same report.
    const mine = await db.from('content_reports').select('id')
      .eq('reporter_athlete_id', caller.athleteId).eq('target_type', input.targetType).eq('target_id', input.targetId)
      .limit(1);
    if (moderationUnmigrated(mine.error)) return unmigratedResponse();
    if (mine.error) return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
    if (mine.data?.length) return NextResponse.json({ id: (mine.data[0] as { id: string }).id }, { status: 201 });

    // 2. Per-reporter cap, so a loop can't fan pushes out to every staff phone.
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await db.from('content_reports').select('id')
      .eq('reporter_athlete_id', caller.athleteId).gte('created_at', since).limit(REPORTS_PER_HOUR);
    if (recent.error) return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
    if ((recent.data?.length ?? 0) >= REPORTS_PER_HOUR) {
      return NextResponse.json({ error: 'too many reports' }, { status: 429, headers: { 'Retry-After': '3600' } });
    }

    // 3. Is this target already open with staff? Then the new report is recorded but not pushed.
    const open = await db.from('content_reports').select('id')
      .eq('target_type', input.targetType).eq('target_id', input.targetId).eq('status', 'open').limit(1);
    const alreadyOpen = !open.error && (open.data?.length ?? 0) > 0;

    const { authorId, verified } = await resolveAuthor(db, input.targetType, input.targetId, input.authorId)
      .catch(() => ({ authorId: input.authorId, verified: false }));
    const row = {
      reporter_athlete_id: caller.athleteId,
      target_type: input.targetType,
      target_id: input.targetId,
      author_athlete_id: authorId,
      reason: input.reason,
      note: input.note,
      status: 'open',
    };
    // Atomic dedupe (223): ON CONFLICT (reporter, target) DO NOTHING. A concurrent twin gets no row back,
    // answers with the existing id and sends no push. Pre-223 there is no unique index to conflict on
    // (42P10) and pre-220 no author_verified column: fall back to the plain insert as before.
    const save = async (payload: Record<string, unknown>) => {
      const up = await db.from('content_reports')
        .upsert(payload, { onConflict: 'reporter_athlete_id,target_type,target_id', ignoreDuplicates: true })
        .select('id');
      if (!up.error) return { data: (up.data?.[0] as { id: string } | undefined) ?? null, error: null, created: !!up.data?.length };
      if ((up.error as { code?: string }).code !== '42P10') return { data: null, error: up.error, created: false };
      const ins = await db.from('content_reports').insert(payload).select('id').single();
      return { data: ins.data as { id: string } | null, error: ins.error, created: !ins.error };
    };
    let ins = await save({ ...row, author_verified: authorId ? verified : null });
    // Pre-220 there is no author_verified column: still save the report, but only a server-checked author.
    if (ins.error && isMissingColumn(ins.error, 'author_verified')) {
      ins = await save({ ...row, author_athlete_id: verified ? authorId : null });
    }
    const { error, created } = ins;
    let data = ins.data;
    if (moderationUnmigrated(error)) return unmigratedResponse();
    if (error) return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
    if (!created || !data) {
      const twin = await db.from('content_reports').select('id')
        .eq('reporter_athlete_id', caller.athleteId).eq('target_type', input.targetType).eq('target_id', input.targetId)
        .limit(1);
      data = (twin.data?.[0] as { id: string } | undefined) ?? null;
      if (!data) return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
      return NextResponse.json({ id: data.id }, { status: 201 });
    }

    const id = (data as { id: string }).id;
    if (!alreadyOpen) {
      // Staff only. The author is never told, and the copy names neither party.
      await notifyStaff({
        kind: 'content_report',
        url: `/dashboard/settings?report=${id}`,
        tag: `content-report-${input.targetType}-${input.targetId}`,
        category: 'management',
        actorAthleteId: caller.athleteId,
        copy: (locale) =>
          locale === 'en'
            ? { title: 'Content reported', body: `A ${input.targetType.replace(/_/g, ' ')} was reported (${input.reason}). Review within 24 hours.` }
            : { title: 'דיווח על תוכן', body: `דווח תוכן (${REASON_HE[input.reason]}) — לבדוק תוך 24 שעות.` },
      });
    }
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    console.error('[moderation/report] failed:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

const LIST_COLUMNS = 'id, reporter_athlete_id, target_type, target_id, author_athlete_id, reason, note, status, created_at, handled_at';

export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const status = new URL(request.url).searchParams.get('status') || 'open';
  if (!['open', 'actioned', 'dismissed'].includes(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  const db = createServerClient();
  const list = (cols: string) => db.from('content_reports').select(cols).eq('status', status)
    .order('created_at', { ascending: false }).limit(200);
  let { data, error } = await list(`${LIST_COLUMNS}, author_verified`);
  if (error && isMissingColumn(error, 'author_verified')) ({ data, error } = await list(LIST_COLUMNS));   // pre-220
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
