import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { getStreamServerClient } from '@/lib/stream/server';
import { moderationUnmigrated, unmigratedResponse } from '@/lib/moderation/blocks';
import {
  LIST_PAGE_DEFAULT, LIST_PAGE_MAX, STATUS_AFTER, auditModeration, cursorOf, hideTarget, isHideable, parseAction, parseCursor,
} from '@/lib/moderation/actions';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const COLS = 'id, reporter_athlete_id, target_type, target_id, author_athlete_id, reason, note, status, created_at, handled_at, handled_by';

/**
 * Staff moderation queue (task 185). Staff only; nothing here notifies anyone.
 *
 * GET  ?status=open|actioned|dismissed&cursor=&limit= → { reports, nextCursor }
 *      Newest first, keyset-paged. Each report carries `reportsOnTarget` (how many reports share
 *      its target, any status) and `hideable`.
 * POST { reportId, action: 'dismiss'|'resolve'|'hide', note? } → { ok, action, outcome, reportsClosed }
 *      Decides on the report's TARGET: every open report on it is closed (dismissed, or actioned
 *      for resolve/hide); `hide` soft-deletes the content first (lib/moderation/actions.ts).
 *      Audited in moderation_actions (migration 348).
 */
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const status = q.get('status') || 'open';
  if (!['open', 'actioned', 'dismissed'].includes(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  const rawCursor = q.get('cursor');
  const cursor = parseCursor(rawCursor);
  if (rawCursor && !cursor) return NextResponse.json({ error: 'invalid cursor' }, { status: 400 });
  const n = Number(q.get('limit'));
  const limit = Number.isInteger(n) && n > 0 ? Math.min(n, LIST_PAGE_MAX) : LIST_PAGE_DEFAULT;
  try {
    const db = createServerClient();
    let sel = db.from('content_reports').select(COLS).eq('status', status);
    if (cursor) sel = sel.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const { data, error } = await sel.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (moderationUnmigrated(error)) return unmigratedResponse();
    if (error) return NextResponse.json(internalErrorBody(), { status: 500 });
    const rows = (data || []) as Array<{ id: string; target_type: string; target_id: string; created_at: string }>;
    const page = rows.slice(0, limit);

    // How many reports each target on this page has — one read for the page, not one per row.
    const targets = [...new Set(page.map((r) => r.target_id))];
    const counts = new Map<string, number>();
    if (targets.length) {
      const { data: all } = await db.from('content_reports').select('target_type, target_id').in('target_id', targets).limit(5000);
      for (const r of (all || []) as Array<{ target_type: string; target_id: string }>) {
        const k = `${r.target_type}:${r.target_id}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    return NextResponse.json({
      reports: page.map((r) => ({ ...r, reportsOnTarget: counts.get(`${r.target_type}:${r.target_id}`) || 1, hideable: isHideable(r.target_type) })),
      nextCursor: rows.length > limit ? cursorOf(page[page.length - 1]) : null,
    }, { headers: PRIVATE });
  } catch (err) {
    console.error('GET /api/moderation/reports failed:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}

export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const parsed = parseAction(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { reportId, action, note } = parsed.value;
  try {
    const db = createServerClient();
    const { data: report, error } = await db.from('content_reports').select('id, target_type, target_id, status').eq('id', reportId).maybeSingle();
    if (moderationUnmigrated(error)) return unmigratedResponse();
    if (error) return NextResponse.json(internalErrorBody(), { status: 500 });
    if (!report) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { target_type: targetType, target_id: targetId } = report as { target_type: string; target_id: string };

    let outcome: string = STATUS_AFTER[action];
    if (action === 'hide') {
      const hidden = await hideTarget(db, getStreamServerClient, targetType, targetId);
      if (hidden === 'unsupported') return NextResponse.json({ error: `a ${targetType} can't be hidden here` }, { status: 422 });
      outcome = hidden;
    }

    const now = new Date().toISOString();
    const { data: closed, error: closeErr } = await db.from('content_reports')
      .update({ status: STATUS_AFTER[action], handled_at: now, handled_by: caller.athleteId })
      .eq('target_type', targetType).eq('target_id', targetId).eq('status', 'open')
      .select('id');
    if (closeErr) return NextResponse.json(internalErrorBody(), { status: 500 });
    const reportsClosed = closed?.length ?? 0;

    await auditModeration(db, {
      report_id: reportId, target_type: targetType, target_id: targetId, action, outcome,
      actor_athlete_id: caller.athleteId, note, reports_closed: reportsClosed,
    });
    return NextResponse.json({ ok: true, action, outcome, reportsClosed }, { headers: PRIVATE });
  } catch (err) {
    console.error('POST /api/moderation/reports failed:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}
