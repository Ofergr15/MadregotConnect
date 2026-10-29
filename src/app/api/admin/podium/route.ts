import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { AUDIENCES, DEFAULT_BUDGET, audienceAllows, roundState, type Audience } from '@/lib/podium/model';
import { createGroupOrder, listRounds, loadOrderById, loadOrders, loadProducts, loadRound, members, toRound } from '@/lib/podium/server';
import { openCopy, sendOpenPush } from '@/lib/podium/notify';

export const dynamic = 'force-dynamic';

/**
 * הזמנת פודיום, the admin's side. GET ?round=: every round, the chosen one (default: the
 * current), the whole catalog (hidden and not-on-site too), every order with the runner's name,
 * every member (for the "specific people" picker) and who the chosen round is for. POST: { action: 'create' | 'update' | 'sent' | 'unsent' | 'delete' }.
 */
export async function GET(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
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
      // Credit is the admin's alone (Ofer, 10-29).
      canCredit: caller.isSuperUser || caller.role === 'admin' || !!caller.roles?.includes('admin'),
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
  const b = await request.json().catch(() => ({})) as { action?: string; id?: string; title?: string; opensAt?: string; locksAt?: string; budget?: number; audience?: string; audienceIds?: string[]; autoNotify?: boolean; notifyTitle?: string; notifyBody?: string; again?: boolean; athleteIds?: string[];
    budgets?: Record<string, number | null>; expectedCount?: number | null; label?: string; orderId?: string; groupBudget?: number | null };
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
  // Migration 175's columns: without them, say so instead of a bare 500.
  const need175 = (e: { code?: string } | null) => (e?.code === 'PGRST204' || e?.code === '42703' || e?.code === '23502')
    ? NextResponse.json({ error: 'not set up', message: 'צריך להריץ את מיגרציה 175' }, { status: 503 }) : null;
  const amount = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 100) / 100 : undefined);
  // Credit (Ofer, 10-29: "only an admin"): a person's own budget in this round; null puts them back on the default.
  if (b.action === 'budgets' && b.id && b.budgets && typeof b.budgets === 'object') {
    if (!caller.isSuperUser && caller.role !== 'admin' && !caller.roles?.includes('admin')) return NextResponse.json({ error: 'admin only', message: 'רק אדמין נותן קרדיט' }, { status: 403 });
    const round = await loadRound(db, b.id);
    if (!round) return NextResponse.json({ error: 'no round' }, { status: 404 });
    const next: Record<string, number> = { ...(round.budgets ?? {}) };
    for (const [k, v] of Object.entries(b.budgets).slice(0, 200)) {
      if (!/^[0-9a-f-]{36}$/i.test(k)) continue;
      const a = amount(v);
      if (a === undefined) return NextResponse.json({ error: 'bad amount', message: 'סכום לא תקין' }, { status: 400 });
      if (a === null || a === round.budget) delete next[k]; else next[k] = a;
    }
    const { error } = await db.from('podium_rounds').update({ budgets: next }).eq('id', round.id);
    if (error) return need175(error) ?? NextResponse.json({ error: 'failed' }, { status: 500 });
    return NextResponse.json({ budgets: next });
  }
  // How many orders the round should end with (the core plus the group ones); null = its audience.
  if (b.action === 'expected' && b.id) {
    const n = b.expectedCount == null ? null : Math.round(Number(b.expectedCount));
    if (n !== null && !(n >= 0 && n <= 500)) return NextResponse.json({ error: 'bad count', message: 'מספר לא תקין' }, { status: 400 });
    const { error } = await db.from('podium_rounds').update({ expected_count: n }).eq('id', b.id);
    if (error) return need175(error) ?? NextResponse.json({ error: 'failed' }, { status: 500 });
    return NextResponse.json({ expectedCount: n });
  }
  // A group order ("אקסטרות"): a name, and its own budget only if an admin gives one.
  const isAdmin = caller.isSuperUser || caller.role === 'admin' || !!caller.roles?.includes('admin');
  if (b.action === 'group' && b.id) {
    const round = await loadRound(db, b.id);
    if (!round) return NextResponse.json({ error: 'no round' }, { status: 404 });
    if (!b.label?.trim()) return NextResponse.json({ error: 'bad label', message: 'צריך שם להזמנה' }, { status: 400 });
    const a = isAdmin ? amount(b.groupBudget) : null;
    if (a === undefined) return NextResponse.json({ error: 'bad amount', message: 'סכום לא תקין' }, { status: 400 });
    try {
      const o = await createGroupOrder(db, round, b.label, a, caller.athleteId);
      return NextResponse.json({ order: o });
    } catch (err) {
      const e = err as { code?: string };
      console.error('[admin/podium] group order failed', err);
      return need175(e) ?? NextResponse.json({ error: 'failed' }, { status: 500 });
    }
  }
  if (b.action === 'groupUpdate' && b.orderId) {
    const o = await loadOrderById(db, b.orderId);
    if (!o || o.athleteId) return NextResponse.json({ error: 'no such group order' }, { status: 404 });
    const patch: Record<string, unknown> = {};
    if (typeof b.label === 'string') {
      if (!b.label.trim()) return NextResponse.json({ error: 'bad label', message: 'צריך שם להזמנה' }, { status: 400 });
      patch.label = b.label.trim().slice(0, 80);
    }
    if ('groupBudget' in b) {
      if (!isAdmin) return NextResponse.json({ error: 'admin only', message: 'רק אדמין נותן קרדיט' }, { status: 403 });
      const a = amount(b.groupBudget);
      if (a === undefined) return NextResponse.json({ error: 'bad amount', message: 'סכום לא תקין' }, { status: 400 });
      patch.budget = a;
    }
    const { error } = await db.from('podium_orders').update(patch).eq('id', o.id);
    if (error) return need175(error) ?? NextResponse.json({ error: 'failed' }, { status: 500 });
    return NextResponse.json({ ok: true });
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
