import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { allAthleteIds } from '@/lib/push';
import { israelToday } from '@/lib/utils';
import {
  trainingDayBeforeCopy, trainingEveningBeforeCopy,
} from '@/lib/notifications/copy';
import {
  APPROVAL_MODES, ASK_HOUR, addDays, dowOf, gateState, withDecision,
  type ApprovalDay, type ApprovalMode, type ApprovalPush,
} from '@/lib/notifications/approval';
import { loadApprovals, qualityOf, saveApprovals } from '@/lib/notifications/approval-server';
import { loadOverrides } from '@/lib/week-setup/server';
import { overrideFor, slotKey, withOverrideCopy, type OverrideStore } from '@/lib/week-setup/model';
import { COACH_ID } from '@/lib/constants';
import { planWeekStartOf } from '@/lib/utils';

const DAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_CFG = { teamDays: [2, 5], dayBefore: { enabled: true, hour: 8 }, eveningBefore: { enabled: true, hour: 18 } };
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

// GET  /api/notifications/approvals → { mode, days: [...] } — the next 8 days'
//      team days, each with whether its pre-workout pushes need an OK, the
//      decision, and the exact pushes (Hebrew copy) that would go out.
// POST { date, action: 'approve' | 'skip' | 'reset' } → the same.
// PUT  { mode: 'quality' | 'team' | 'off' } → the same.
//
// Approvers and the super user only: the decision stops or releases a push to
// the whole club. See lib/notifications/approval.ts.
async function gate(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth), who: '' };
  if (!auth.user.canApprove && !auth.user.isSuperUser) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), who: '' };
  }
  return { denied: null, who: auth.user.name || auth.user.email };
}

export async function GET(request: Request) {
  const { denied } = await gate(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await view(createServerClient()));
  } catch (err) {
    console.error('[notifications/approvals] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { denied, who } = await gate(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const date = typeof body?.date === 'string' ? body.date : '';
  const action = body?.action;
  if (!DATE.test(date) || !['approve', 'skip', 'reset'].includes(action)) {
    return NextResponse.json({ error: 'date YYYY-MM-DD and action approve|skip|reset' }, { status: 400 });
  }
  try {
    const supabase = createServerClient();
    const store = await loadApprovals(supabase);
    const decision = action === 'reset' ? null
      : { status: action === 'approve' ? 'approved' as const : 'skipped' as const, by: who, at: new Date().toISOString() };
    await saveApprovals(supabase, withDecision(store, date, decision, israelToday()));
    return NextResponse.json(await view(supabase));
  } catch (err) {
    console.error('[notifications/approvals] POST failed:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { denied } = await gate(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const mode = body?.mode as ApprovalMode;
  if (!APPROVAL_MODES.includes(mode)) return NextResponse.json({ error: 'mode quality|team|off' }, { status: 400 });
  try {
    const supabase = createServerClient();
    const store = await loadApprovals(supabase);
    await saveApprovals(supabase, { ...store, mode });
    return NextResponse.json(await view(supabase));
  } catch (err) {
    console.error('[notifications/approvals] PUT failed:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

async function view(supabase: ReturnType<typeof createServerClient>) {
  const [store, cfgRow, athletes, overrides, groupsRes] = await Promise.all([
    loadApprovals(supabase),
    supabase.from('app_settings').select('value').eq('key', 'reminder_config').maybeSingle(),
    allAthleteIds(),
    loadOverrides(supabase).catch(() => ({} as OverrideStore)),
    supabase.from('groups').select('id, name').eq('coach_id', COACH_ID),
  ]);
  const groups = ((groupsRes.data || []) as Array<{ id: string; name: string }>).sort((a, b) => a.name.localeCompare(b.name));
  const groupName = (id: string | null | undefined) => groups.find((g) => g.id === id)?.name ?? null;
  let cfg = DEFAULT_CFG;
  try { cfg = { ...DEFAULT_CFG, ...JSON.parse(cfgRow.data?.value || '') }; } catch { /* default */ }

  const today = israelToday();
  const dates = Array.from({ length: 8 }, (_, i) => addDays(today, i)).filter((d) => cfg.teamDays.includes(dowOf(d)));
  const days: ApprovalDay[] = [];
  for (const date of dates) {
    const day = dowOf(date);
    const quality = await qualityOf(supabase, date);
    const decision = store.days[date];
    const pushes: ApprovalPush[] = [];
    const week = planWeekStartOf(date); // the team day's own plan-week, as the tick reads it
    const all = `כל הרצים (${athletes.length})`;
    const prevDay = DAY_HE[(day + 6) % 7];
    const push = (stage: 'dayBefore' | 'eveningBefore', defHour: number, c: { title: string; body: string }, audienceDefault: string) => {
      const o = overrideFor(overrides, week, stage, day);
      const g = groupName(o?.audience);
      const shown = withOverrideCopy(c, o);
      pushes.push({
        key: stage, slot: slotKey(stage, day), week,
        when: `${prevDay} · ${hh(o?.hour ?? defHour)}`, hour: o?.hour ?? defHour, defaultHour: defHour,
        audience: g ? `רק ${g}` : audienceDefault, audienceId: o?.audience ?? null,
        off: !!o?.off, edited: !!o, title: shown.title, body: shown.body, defaultTitle: c.title, defaultBody: c.body,
      });
    };
    if (cfg.dayBefore.enabled) push('dayBefore', cfg.dayBefore.hour, trainingDayBeforeCopy('he', { day }), all);
    if (cfg.eveningBefore.enabled) push('eveningBefore', cfg.eveningBefore.hour, trainingEveningBeforeCopy('he', { day, goingCount: 0 }), 'רק מי שלא אישר הגעה');
    days.push({
      date, dayOfWeek: day, askAt: `${DAY_HE[(day + 5) % 7]} ${hh(ASK_HOUR)}`,
      workoutName: quality?.name || null,
      quality: !!quality,
      state: gateState(store, date, store.mode === 'team' || !!quality),
      decidedBy: decision?.by ?? null,
      decidedAt: decision?.at ?? null,
      pushes,
    });
  }
  return { mode: store.mode, today, days, groups };
}
