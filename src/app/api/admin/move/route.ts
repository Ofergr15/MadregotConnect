import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { readMaintenance } from '@/lib/maintenance';
import { sendPushDetailed } from '@/lib/push';
import { appendMoveLog, baseInfo, onNewProject, readMoveSnapshot, readMoveStatus, writeMoveSnapshot } from '@/lib/move/state';
import { takeSnapshot } from '@/lib/move/checks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET  /api/admin/move — where the app is, and the move's progress (lib/move/state.ts).
// POST /api/admin/move — the screen's few actions. Super user only, both.
//
// Maintenance itself is switched through PUT /api/maintenance (the one place that
// keeps the caller on the allow-list); this route only records what happened.

async function gate(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return { res: authError(auth) } as const;
  if (!auth.user.isSuperUser) return { res: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) } as const;
  return { auth } as const;
}

export async function GET(request: Request) {
  const g = await gate(request);
  if ('res' in g) return g.res;
  const [status, snap, maint] = await Promise.all([readMoveStatus(), readMoveSnapshot(), readMaintenance()]);
  return NextResponse.json({
    ...baseInfo(),
    status,
    snapshot: snap ? { at: snap.at, source: snap.source, tables: Object.keys(snap.tables).length, rows: Object.values(snap.tables).reduce((a, b) => a + Math.max(b, 0), 0) } : null,
    maintenance: { on: maint.on, allow: maint.allow },
  });
}

export async function POST(request: Request) {
  const g = await gate(request);
  if ('res' in g) return g.res;
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  const who = g.auth.user.email;
  try {
    switch (action) {
      case 'baseline': {
        // A baseline on the database the app is on. Never on Frankfurt once the
        // move has started: there the snapshot is the frozen-Tokyo one, and
        // overwriting it would make every comparison compare Frankfurt to itself.
        const st = await readMoveStatus();
        if (onNewProject() && st.phase !== 'idle') return NextResponse.json({ error: 'The Tokyo snapshot is what Frankfurt is checked against; not overwriting it.' }, { status: 409 });
        const snap = await takeSnapshot(baseInfo().host);
        await writeMoveSnapshot(snap);
        await appendMoveLog(`Baseline saved on ${baseInfo().ref}: ${Object.keys(snap.tables).length} tables`);
        return NextResponse.json({ ok: true });
      }
      case 'start':
        return NextResponse.json({ status: await appendMoveLog(`Move started by ${who}: maintenance on`, { phase: 'start_requested', startedAt: new Date().toISOString() }) });
      case 'opened': {
        // The crons were paused for the window (lib/cron-pause.ts); the club is back, so are they.
        await createServerClient().from('app_settings')
          .upsert({ key: 'cron_paused', value: 'off', updated_at: new Date().toISOString() }, { onConflict: 'key' });
        return NextResponse.json({ status: await appendMoveLog(`App opened to everyone by ${who}; background jobs resumed`, { phase: 'open', openedAt: new Date().toISOString() }) });
      }
      case 'rollback':
        return NextResponse.json({ status: await appendMoveLog(`ROLLBACK requested by ${who}`, { phase: 'rollback_requested' }, false) });
      case 'test-push': {
        const athleteId = g.auth.user.athleteId;
        if (!athleteId) return NextResponse.json({ error: 'No athlete row to push to.' }, { status: 400 });
        const { data } = await createServerClient().from('push_subscriptions').select('id, endpoint, p256dh, auth, athlete_id').eq('athlete_id', athleteId);
        const r = await sendPushDetailed((data || []) as never, { title: 'בדיקת מעבר', body: `התראה מהשרת ב-${baseInfo().functionRegion}, מסד ${baseInfo().ref}`, url: '/dashboard/move', tag: 'move-check' });
        return NextResponse.json({ sent: r.sent, devices: (data || []).length });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
