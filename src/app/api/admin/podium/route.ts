import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { AUDIENCES, DEFAULT_BUDGET, audienceAllows, roundState, type Audience } from '@/lib/podium/model';
import { listRounds, loadOrders, loadProducts, loadRound, members, toRound } from '@/lib/podium/server';
import { openCopy, sendOpenPush } from '@/lib/podium/notify';

export const dynamic = 'force-dynamic';

/**
 * הזמנת פודיום, the admin's side. GET ?round=: every round, the chosen one (default: the
 * current), the whole catalog (hidden and not-on-site too), every order with the runner's name,
 * every member (for the "specific people" picker) and who the chosen round is for. POST: { action: 'create' | 'update' | 'sent' | 'unsent' | 'delete' }.
 */
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const db = createServerClient();
  try {
    const [rounds, products, all] = await Promise.all([listRounds(db), loadProducts(db), members(db)]);
    const want = new URL(request.url).searchParams.get('round');
    const round = rounds.find((r) => r.id === want) ?? rounds.find((r) => !r.sentAt) ?? rounds[0] ?? null;
    const orders = round ? await loadOrders(db, round.id) : [];
    const audience = round ? all.filter((m) => audienceAllows(round, { athleteId: m.id, isCore: m.isCore, isStaff: m.isStaff })).map((m) => m.id) : [];
    return NextResponse.json({
      rounds: rounds.map((r) => ({ ...r, state: roundState(r) })),
      round: round && { ...round, state: roundState(round) },
      products, orders, core: audience,
      people: Object.fromEntries(all.map((m) => [m.id, { name: m.name, avatarUrl: m.avatarUrl, isCore: m.isCore, isStaff: m.isStaff }])),
    });
  } catch (err) {
    console.error('[admin/podium] read failed', err);
    return NextResponse.json({ error: 'not set up', message: 'צריך להריץ את מיגרציה 172' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const b = await request.json().catch(() => ({})) as { action?: string; id?: string; title?: string; opensAt?: string; locksAt?: string; budget?: number; audience?: string; audienceIds?: string[]; autoNotify?: boolean; notifyTitle?: string; notifyBody?: string; again?: boolean; athleteIds?: string[] };
  const db = createServerClient();
  const valid = (s?: string) => !!s && !Number.isNaN(Date.parse(s));
  if (b.action === 'create' || b.action === 'update') {
    if (!b.title?.trim() || !valid(b.opensAt) || !valid(b.locksAt) || Date.parse(b.locksAt!) <= Date.parse(b.opensAt!)) {
      return NextResponse.json({ error: 'bad round', message: 'צריך שם, פתיחה וסגירה (הסגירה אחרי הפתיחה)' }, { status: 400 });
    }
    // Core at most (Ofer 10-26): anything else that isn't one of the offered audiences becomes the core.
    const audience = (AUDIENCES.some((a) => a.key === b.audience) ? b.audience : 'core') as Audience;
    const ids = Array.isArray(b.audienceIds) ? b.audienceIds.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500) : [];
    if (audience === 'people' && ids.length === 0) return NextResponse.json({ error: 'bad round', message: 'צריך לבחור לפחות אדם אחד' }, { status: 400 });
    const row = { title: b.title.trim(), opens_at: b.opensAt, locks_at: b.locksAt, budget: Number(b.budget) > 0 ? Number(b.budget) : DEFAULT_BUDGET, audience, audience_ids: audience === 'people' ? ids : [],
      auto_notify: b.autoNotify !== false, notify_title: b.notifyTitle?.trim().slice(0, 80) || null, notify_body: b.notifyBody?.trim().slice(0, 240) || null };
    // Before migration 174 the notification columns don't exist: save the round without them.
    const lean = (x: Record<string, unknown>) => { const { auto_notify: _a, notify_title: _t, notify_body: _b, ...rest } = x; return rest; };
    const missingCol = (e: { code?: string } | null) => e?.code === 'PGRST204' || e?.code === '42703';
    if (b.action === 'create') {
      let { data, error } = await db.from('podium_rounds').insert({ ...row, created_by: caller.athleteId }).select('id').single();
      if (missingCol(error)) ({ data, error } = await db.from('podium_rounds').insert({ ...lean(row), created_by: caller.athleteId }).select('id').single());
      if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
      return NextResponse.json({ id: (data as { id: string }).id });
    }
    const prev = b.id ? await loadRound(db, b.id) : null;
    if (!prev) return NextResponse.json({ error: 'no round' }, { status: 404 });
    // A later lock re-arms the reminder. ("It's open" keeps a per-person ledger, so widening the
    // audience tells only the newcomers — lib/podium/notify.)
    const rearm = Date.parse(b.locksAt!) !== Date.parse(prev.locksAt) ? { notified_remind_at: null, notified_lock_at: null } : {};
    let { error } = await db.from('podium_rounds').update({ ...row, ...rearm }).eq('id', prev.id);
    if (missingCol(error)) ({ error } = await db.from('podium_rounds').update({ ...lean(row), ...rearm }).eq('id', prev.id));
    if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
    return NextResponse.json({ id: prev.id });
  }
  // "🔔 לשלוח התראה עכשיו": to whoever hasn't had it, or ({ again: true }) to everyone in the audience.
  if (b.action === 'notify' && b.id) {
    const { data: raw } = await db.from('podium_rounds').select('*').eq('id', b.id).maybeSingle();
    if (!raw) return NextResponse.json({ error: 'no round' }, { status: 404 });
    const round = toRound(raw);
    if (roundState(round) !== 'open') return NextResponse.json({ error: 'not open', message: 'אפשר לשלוח התראה רק כשההזמנה פתוחה' }, { status: 409 });
    const only = Array.isArray(b.athleteIds) ? b.athleteIds.filter((x) => typeof x === 'string').slice(0, 50) : undefined;
    const sent = await sendOpenPush(db, round, raw, { again: !!b.again, only });
    if (only && !sent) return NextResponse.json({ error: 'not in audience', message: 'ההזמנה לא פתוחה לאדם הזה' }, { status: 409 });
    return NextResponse.json({ sent, copy: openCopy(round, raw) });
  }
  if ((b.action === 'sent' || b.action === 'unsent' || b.action === 'delete') && b.id) {
    const q = b.action === 'delete'
      ? db.from('podium_rounds').delete().eq('id', b.id)
      : db.from('podium_rounds').update({ sent_at: b.action === 'sent' ? new Date().toISOString() : null }).eq('id', b.id);
    const { error } = await q;
    if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
