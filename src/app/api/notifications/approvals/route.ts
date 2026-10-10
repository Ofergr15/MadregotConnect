import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { allAthleteIds } from '@/lib/push';
import { israelToday } from '@/lib/utils';
import {
  trainingDayBeforeCopy, trainingEveningBeforeCopy, surveyNudgeCopy,
} from '@/lib/notifications/copy';
import {
  APPROVAL_MODES, addDays, dowOf, gateState, withDecision,
  type ApprovalDay, type ApprovalMode, type ApprovalPush,
} from '@/lib/notifications/approval';
import { loadApprovals, qualityOf, saveApprovals } from '@/lib/notifications/approval-server';

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
  const [store, cfgRow, athletes] = await Promise.all([
    loadApprovals(supabase),
    supabase.from('app_settings').select('value').eq('key', 'reminder_config').maybeSingle(),
    allAthleteIds(),
  ]);
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
    const all = `כל הרצים (${athletes.length})`;
    if (cfg.dayBefore.enabled) {
      const c = trainingDayBeforeCopy('he', { day });
      pushes.push({ key: 'dayBefore', when: `יום לפני · ${hh(cfg.dayBefore.hour)}`, audience: all, ...c });
      pushes.push({ key: 'paceSurvey', when: `יום לפני · ${hh(cfg.dayBefore.hour)}`, audience: all, title: 'סקר דבוקות', body: 'עם איזו דבוקה רצים מחר' });
    }
    if (cfg.eveningBefore.enabled) {
      const c = trainingEveningBeforeCopy('he', { day, goingCount: 0 });
      pushes.push({ key: 'eveningBefore', when: `יום לפני · ${hh(cfg.eveningBefore.hour)}`, audience: 'רק מי שלא אישר הגעה', ...c });
      const n = surveyNudgeCopy('he', { day });
      pushes.push({ key: 'paceSurveyNudge', when: `יום לפני · ${hh(cfg.eveningBefore.hour)}`, audience: 'רק מי שלא בחר דבוקה', ...n });
    }
    days.push({
      date, dayOfWeek: day,
      workoutName: quality?.name || null,
      quality: !!quality,
      state: gateState(store, date, store.mode === 'team' || !!quality),
      decidedBy: decision?.by ?? null,
      decidedAt: decision?.at ?? null,
      pushes,
    });
  }
  return { mode: store.mode, today, days };
}
