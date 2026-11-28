import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { computeMutedAthleteIds } from '@/lib/push';
import { coachMessageCopy } from '@/lib/notifications/copy';
import {
  BULK_DRY_RUNS_PER_HOUR, BULK_TEXT_MAX, MIGRATION_325, MIGRATION_325_TEXT, isMissingTable, planBulkMessage, readGroupFilter,
} from '@/lib/admin/not-run';
import { loadNotRun } from '@/lib/admin/not-run-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/not-run/message  { text, group?: packId | 'none' }
 *
 * The DRY RUN of "send a message to whoever hasn't run this week": the same people GET
 * /api/admin/not-run lists, and how a coach_message would land for each (push, no device,
 * or muted — "מהמאמן" off), plus the copy as it would read. Nothing is
 * sent and nothing is written to anyone's inbox. `dryRun: false` is refused: real sending
 * is not built (owner question in docs/night-questions.md).
 *
 * Staff only, never while viewing as someone. Every dry run is an audit row
 * (staff_bulk_message_log, migration 325), and those rows are the rate limit:
 * BULK_DRY_RUNS_PER_HOUR per staff member. No table → 409, never an unaudited run.
 */
export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { text?: unknown; group?: unknown; dryRun?: unknown } | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  if (body.dryRun === false) return NextResponse.json({ error: 'Only a dry run is available; nothing is sent.' }, { status: 400 });
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });
  if (text.length > BULK_TEXT_MAX) return NextResponse.json({ error: `text is limited to ${BULK_TEXT_MAX} characters` }, { status: 400 });
  const filter = readGroupFilter(body.group);
  if (!filter) return NextResponse.json({ error: 'group must be a pack id, "none" or omitted' }, { status: 400 });

  const db = createServerClient();
  try {
    // The rate limit is the audit table itself: the last hour's rows by this caller.
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const recent = caller.athleteId
      ? db.from('staff_bulk_message_log').select('id', { count: 'exact', head: true }).eq('actor_athlete_id', caller.athleteId).gte('created_at', since)
      : db.from('staff_bulk_message_log').select('id', { count: 'exact', head: true }).eq('actor_email', caller.email).gte('created_at', since);
    const { count, error: countError } = await recent;
    if (isMissingTable(countError)) return NextResponse.json({ error: MIGRATION_325, message: MIGRATION_325_TEXT }, { status: 409 });
    if (countError) throw countError;
    if ((count ?? 0) >= BULK_DRY_RUNS_PER_HOUR) {
      return NextResponse.json({ error: `Limit of ${BULK_DRY_RUNS_PER_HOUR} an hour reached` }, { status: 429, headers: { 'Retry-After': '3600' } });
    }

    const list = await loadNotRun(db, filter);
    const people = list.groups.flatMap((g) => g.people);
    const ids = people.map((p) => p.id);
    const [prefs, subs, devices, sender] = ids.length
      ? await Promise.all([
        db.from('athletes').select('id, role, notification_prefs').in('id', ids),
        db.from('push_subscriptions').select('athlete_id').in('athlete_id', ids),
        db.from('athlete_devices').select('athlete_id').in('athlete_id', ids),
        caller.athleteId ? db.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ])
      : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: null, error: null }];
    if (prefs.error || subs.error) throw prefs.error ?? subs.error;
    const withDevice = new Set([
      ...((subs.data ?? []) as Array<{ athlete_id: string }>).map((s) => s.athlete_id),
      // A missing native-device table only means nobody has the native app yet.
      ...(devices.error ? [] : ((devices.data ?? []) as Array<{ athlete_id: string }>).map((d) => d.athlete_id)),
    ]);
    const muted = computeMutedAthleteIds((prefs.data ?? []) as Array<{ id: string; role?: string | null; notification_prefs?: Record<string, boolean> | null }>, 'coach');
    const plan = planBulkMessage(ids, withDevice, muted);
    const coachName = ((sender.data as { name?: string | null } | null)?.name || 'המאמן').trim();

    const { error: auditError } = await db.from('staff_bulk_message_log').insert({
      actor_athlete_id: caller.athleteId, actor_email: caller.email, action: 'not_run_dry_run', dry_run: true,
      group_id: filter.kind === 'group' ? filter.id : null, no_group: filter.kind === 'none', text,
      recipient_count: plan.recipients, push_count: plan.push.length, inbox_only_count: plan.inboxOnly.length, muted_count: plan.muted.length,
    });
    if (isMissingTable(auditError)) return NextResponse.json({ error: MIGRATION_325, message: MIGRATION_325_TEXT }, { status: 409 });
    if (auditError) throw auditError;

    const name = new Map(people.map((p) => [p.id, p.name]));
    const named = (xs: string[]) => xs.map((id) => ({ id, name: name.get(id) ?? '—' }));
    return NextResponse.json({
      dryRun: true,
      sent: 0,
      weekStart: list.weekStart,
      filter,
      preview: { he: coachMessageCopy('he', { coachName, text }), en: coachMessageCopy('en', { coachName, text }) },
      recipients: plan.recipients,
      push: named(plan.push),
      inboxOnly: named(plan.inboxOnly),
      muted: named(plan.muted),
      limit: { perHour: BULK_DRY_RUNS_PER_HOUR, used: (count ?? 0) + 1 },
    });
  } catch (err) {
    console.error('[api/admin/not-run/message]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
