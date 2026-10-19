import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import type { ParsedWorkout } from '@/lib/ai/types';
import { classifyWorkout, type WorkoutType } from '@/lib/plans/session-summary';
import { trainingDayBeforeCopy, trainingEveningBeforeCopy } from '@/lib/notifications/copy';
import { loadApprovals, qualityOf } from '@/lib/notifications/approval-server';
import { gateState } from '@/lib/notifications/approval';
import { PLAN_DAYS_KEY, parsePlanDays } from '@/lib/quality-session/plan-days';
import { folderName, readFolderLedger, type FolderEntry } from '@/lib/quality-session/photos-server';
import {
  OVERRIDES_KEY, OWNERS_KEY, addDays, normalizeOwners, readiness, weekTimeline,
  type OverrideStore, type Owners, type Readiness, type TimelineRow,
} from './model';

type Db = ReturnType<typeof createServerClient>;

/**
 * The week as the "תחילת שבוע" screen shows it, read from what already exists: the
 * plan rows, the one-day sessions, the program PDFs, the reminder settings and the
 * tick's own ledger, the approvals, the quality-day pick and the photo folders. Only
 * the owners and this week's notification changes are new (lib/week-setup/model.ts).
 */

export async function readSetting<T>(supabase: Db, key: string, fallback: T): Promise<T> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (!data?.value) return fallback;
  try { return (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) as T; } catch { return fallback; }
}

export async function writeSetting(supabase: Db, key: string, value: unknown): Promise<void> {
  const { error } = await supabase.from('app_settings')
    .upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

export const loadOverrides = (supabase: Db) => readSetting<OverrideStore>(supabase, OVERRIDES_KEY, {});
export const loadOwners = async (supabase: Db): Promise<Owners> => normalizeOwners(await readSetting(supabase, OWNERS_KEY, null));

interface ReminderConfig { teamDays: number[]; dayBefore: { enabled: boolean; hour: number }; eveningBefore: { enabled: boolean; hour: number }; workoutHour: number }
const REMINDER_DEFAULT: ReminderConfig = { teamDays: [2, 5], dayBefore: { enabled: true, hour: 8 }, eveningBefore: { enabled: true, hour: 18 }, workoutHour: 5 };

export interface WeekDay {
  dayOfWeek: number;
  date: string;
  /** The day's sessions in the default lane (pack 2), the way the club reads its week. */
  sessions: Array<{ name: string; km: number; optional: boolean; type: WorkoutType }>;
  daySession: { title: string; startTime: string | null; quality: boolean; nutrition: Array<{ when: string; text: string }> } | null;
  team: boolean;
  quality: boolean;
  /** What the evening-before automation would call this day's photo folder. */
  folderName: string;
}

export interface WeekSnapshot {
  weekStart: string;
  plan: { status: 'none' | 'draft' | 'partial' | 'pushed'; createdAt: string | null };
  pdf: { training: string | null; nutrition: string | null };
  /** program_weeks.week_number for this week (or the next after the last one), for the PDF upload. */
  weekNumber: number;
  days: WeekDay[];
  teamDays: number[];
  workoutHour: number;
  qualityDays: number[];
  /** The pick for this week was made by hand (else it is the plan's own guess). */
  qualityPicked: boolean;
  folders: Record<string, FolderEntry>;
  timeline: TimelineRow[];
  approvalMode: string;
  polls: Array<{ dayOfWeek: number; question: string; options: string[]; active: boolean }>;
  owners: Owners;
  staff: Array<{ id: string; name: string; role: string }>;
  readiness: Readiness;
}

const LANE = 'group2';

function typeOf(w: unknown): WorkoutType {
  try { return classifyWorkout({ steps: [], ...(w as object) } as unknown as ParsedWorkout); } catch { return 'easy'; }
}

export async function loadWeek(supabase: Db, weekStart: string): Promise<WeekSnapshot> {
  const weekEnd = addDays(weekStart, 6);
  const [plans, sessions, program, lastProgram, reminderRaw, fired, approvals, planDaysRaw, folders, overrides, owners, templates, custom, staff] = await Promise.all([
    supabase.from('weekly_plans').select('status, created_at, parsed_workouts').eq('coach_id', COACH_ID).is('athlete_id', null).eq('week_start_date', weekStart),
    supabase.from('day_sessions').select('session_date, title, start_time, quality, nutrition').gte('session_date', weekStart).lte('session_date', weekEnd),
    supabase.from('program_weeks').select('week_number, training_pdf_url, nutrition_pdf_url').eq('week_start_date', weekStart).maybeSingle(),
    supabase.from('program_weeks').select('week_number, week_start_date').lt('week_start_date', weekStart).order('week_start_date', { ascending: false }).limit(1).maybeSingle(),
    readSetting<Partial<ReminderConfig>>(supabase, 'reminder_config', {}),
    supabase.from('scheduled_notifications').select('url').eq('status', 'sent').like('url', '#ledger:%')
      .gte('last_sent_at', `${addDays(weekStart, -2)}T00:00:00Z`).lte('last_sent_at', `${addDays(weekEnd, 1)}T23:59:59Z`).limit(500),
    loadApprovals(supabase).catch(() => null),
    supabase.from('app_settings').select('value').eq('key', PLAN_DAYS_KEY).maybeSingle(),
    readFolderLedger(supabase).catch(() => ({} as Record<string, FolderEntry>)),
    loadOverrides(supabase),
    loadOwners(supabase),
    supabase.from('recurring_survey_templates').select('day_of_week, question_he, options_he, active'),
    supabase.from('scheduled_notifications').select('id, title_he, body_he, scheduled_at, next_run_at, last_sent_at, status, audience_type')
      .eq('kind', 'custom').in('status', ['scheduled', 'sent'])
      .gte('next_run_at', `${addDays(weekStart, -1)}T21:00:00Z`).lte('next_run_at', `${weekEnd}T21:00:00Z`).limit(50),
    supabase.from('athletes').select('id, name, role, extra_roles, is_super_user').or('role.in.(admin,coach),is_super_user.eq.true'),
  ]);

  const cfg: ReminderConfig = { ...REMINDER_DEFAULT, ...reminderRaw, dayBefore: { ...REMINDER_DEFAULT.dayBefore, ...reminderRaw.dayBefore }, eveningBefore: { ...REMINDER_DEFAULT.eveningBefore, ...reminderRaw.eveningBefore } };
  const rows = (plans.data ?? []) as Array<{ status: string; created_at: string; parsed_workouts: Record<string, { workouts?: Array<{ dayOfWeek: number; name: string; expectedDistanceM?: number; optional?: boolean }> }> }>;
  const plan = rows.find((r) => r.status === 'pushed') ?? rows.find((r) => r.status === 'partial') ?? rows[0] ?? null;
  const lane = plan?.parsed_workouts?.[LANE]?.workouts ?? plan?.parsed_workouts?.group1?.workouts ?? [];
  const picked = parsePlanDays((planDaysRaw.data?.value as string | null) ?? null)[weekStart];
  const sessionsByDate = new Map((sessions.data ?? []).map((s: { session_date: string; title: string | null; start_time: string | null; quality: boolean | null; nutrition: unknown }) => [s.session_date, s]));

  const days: WeekDay[] = Array.from({ length: 7 }, (_, d) => {
    const date = addDays(weekStart, d);
    const ds = sessionsByDate.get(date);
    return {
      dayOfWeek: d,
      date,
      sessions: lane.filter((w) => w.dayOfWeek === d).map((w) => ({ name: w.name, km: Math.round((w.expectedDistanceM ?? 0) / 100) / 10, optional: !!w.optional, type: typeOf(w) })),
      daySession: ds ? {
        title: ds.title || '', startTime: ds.start_time ? ds.start_time.slice(0, 5) : null, quality: !!ds.quality,
        nutrition: Array.isArray(ds.nutrition) ? (ds.nutrition as Array<{ when: string; text: string }>) : [],
      } : null,
      team: cfg.teamDays.includes(d),
      quality: picked ? picked.includes(d) : !!ds?.quality,
      folderName: folderName(date),
    };
  });

  const firedTags = new Set((fired.data ?? []).map((r: { url: string }) => r.url.replace(/^#ledger:/, '')));
  // The approval rule the tick applies (lib/notifications/approval), per team date — with the
  // tick's own "is it a quality day" (qualityOf), not this screen's pick, so the two agree.
  const teamDates = cfg.teamDays.map((d) => addDays(weekStart, d));
  const qualityDates = new Set<string>();
  if (approvals?.mode === 'quality') {
    const q = await Promise.all(teamDates.map((d) => qualityOf(supabase, d).catch(() => null)));
    teamDates.forEach((d, i) => { if (q[i]) qualityDates.add(d); });
  }
  const approvalFor = (teamDate: string) => (approvals && approvals.mode !== 'off'
    ? gateState(approvals, teamDate, approvals.mode === 'team' || qualityDates.has(teamDate))
    : 'not_needed');

  const timeline = weekTimeline({
    weekStart,
    teamDays: cfg.teamDays,
    dayBefore: cfg.dayBefore,
    eveningBefore: cfg.eveningBefore,
    fired: firedTags,
    overrides,
    approval: approvalFor,
    copy: (stage, teamDay) => (stage === 'dayBefore'
      ? trainingDayBeforeCopy('he', { day: teamDay, askPack: false })
      : trainingEveningBeforeCopy('he', { day: teamDay, goingCount: 0, askPack: false })),
    custom: (custom.data ?? []).map((c: { id: string; title_he: string; body_he: string; next_run_at: string | null; scheduled_at: string | null; last_sent_at: string | null; status: string; audience_type: string }) => ({
      id: c.id, title: c.title_he, body: c.body_he, at: c.last_sent_at || c.next_run_at || c.scheduled_at || `${weekStart}T09:00:00Z`, audience: c.audience_type, sent: c.status === 'sent',
    })),
  });

  const staffRows = (staff.data ?? []) as Array<{ id: string; name: string; role: string; extra_roles: string[] | null; is_super_user: boolean | null }>;
  const status = (plan?.status ?? 'none') as WeekSnapshot['plan']['status'];
  const folderMap: Record<string, FolderEntry> = {};
  for (const d of days) if (folders[d.date]) folderMap[d.date] = folders[d.date];

  return {
    weekStart,
    plan: { status: ['draft', 'partial', 'pushed'].includes(status) ? status : 'none', createdAt: plan?.created_at ?? null },
    pdf: { training: program.data?.training_pdf_url ?? null, nutrition: program.data?.nutrition_pdf_url ?? null },
    weekNumber: program.data?.week_number
      ?? (lastProgram.data ? lastProgram.data.week_number + Math.round((Date.parse(weekStart) - Date.parse(lastProgram.data.week_start_date)) / (7 * 86_400_000)) : 1),
    days,
    teamDays: cfg.teamDays,
    workoutHour: cfg.workoutHour,
    qualityDays: days.filter((d) => d.quality).map((d) => d.dayOfWeek),
    qualityPicked: !!picked,
    folders: folderMap,
    timeline,
    approvalMode: approvals?.mode ?? 'off',
    polls: (templates.data ?? []).map((t: { day_of_week: number; question_he: string; options_he: string[] | null; active: boolean }) => ({ dayOfWeek: t.day_of_week, question: t.question_he, options: t.options_he ?? [], active: !!t.active })),
    owners,
    staff: staffRows.filter((s) => !/^test /i.test(s.name)).map((s) => ({ id: s.id, name: s.name, role: s.is_super_user ? 'admin' : s.role })),
    readiness: readiness({
      planStatus: plan ? (status as 'draft' | 'partial' | 'pushed') : 'none',
      nutritionPdf: !!program.data?.nutrition_pdf_url,
      qualityPicked: !!picked,
      toApprove: timeline.filter((r) => r.state === 'approve').length,
    }),
  };
}

/** The Sunday of the week `date` is in, and of the next one. */
export function weekStartOf(date: string = israelToday()): string {
  const d = new Date(`${date}T12:00:00Z`);
  return addDays(date, -d.getUTCDay());
}
export { qualityOf };
