'use client';

// The coach space's shared pieces (mockup staff-ia/full.html, "יאיר · אימונים"): the card,
// the screen header, the avatar, the data hooks over the app's existing staff routes, and the
// one runner card every tab opens ("נגיעה ברץ, מכל מקום, פותחת את אותו כרטיס מלא").

import { createContext, useContext, useMemo, useState } from 'react';
import Link from 'next/link';
import { cn, israelToday, planWeekStartOf } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { COACH_ID } from '@/lib/constants';
import { useNavIdentity } from '@/lib/nav-items';
import { useCoachSpace } from '@/lib/coach-space/use-coach-space';
import { initials, packOf, type CoachPerson, type FeedbackItem, type VolumeRow, type WatchCell } from '@/lib/coach-space/model';
import { EmptyState } from '@/components/ui';
import { Sheet } from '@/components/ui';
import { RunnerCard } from './RunnerCard';
import { CoachSpaceSwitchRow } from './CoachSpaceSwitchRow';

export const B = ({ children }: { children: React.ReactNode }) => <bdi dir="ltr">{children}</bdi>;

export function Card({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: 'warn' }) {
  return (
    <section className={cn('mx-4 mb-3 rounded-[22px] p-4', tone === 'warn' ? 'bg-[#FFF4E5]' : 'bg-card', className)}>{children}</section>
  );
}

export function CardHead({ title, side }: { title: React.ReactNode; side?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h2 className="text-[15px] font-extrabold text-ink-900">{title}</h2>
      {side && <span className="text-[12px] font-bold text-ink-400">{side}</span>}
    </div>
  );
}

export function ScreenHeader({ title }: { title: string }) {
  return (
    <div className="flex items-end justify-between px-[18px] pb-3 pt-2">
      <div>
        <p className="text-[12.5px] font-bold text-ink-400">אימונים · מאמן</p>
        <h1 className="text-[30px] font-black leading-tight tracking-tight text-ink-900">{title}</h1>
      </div>
    </div>
  );
}

const PACK_BG: Record<string, string> = { A: 'bg-[#C2410C]', B: 'bg-brand-600', C: 'bg-accent-900' };

export function Avatar({ person, size = 40 }: { person: { name: string; avatarUrl?: string | null; groupName?: string | null; squad?: string | null }; size?: number }) {
  const pack = packOf(person.groupName ?? person.squad ?? null);
  return (
    <span
      className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-full font-extrabold text-white', pack ? PACK_BG[pack] : 'bg-ink-300')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials(person.name)}
      {person.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.avatarUrl} alt="" onError={(e) => e.currentTarget.remove()} className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}

export function PackTag({ pack }: { pack: string | null }) {
  if (!pack) return null;
  return <span className={cn('rounded-md px-1.5 py-px text-[11px] font-extrabold text-white', PACK_BG[pack] ?? 'bg-ink-300')}><B>{pack}</B></span>;
}

export function Loading() {
  return (
    <div className="space-y-3 px-4" aria-busy>
      {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-[22px] bg-card" />)}
    </div>
  );
}

// ── data, every piece from a route the app already has ──────────────────────────────

export interface PeopleData { today: string; people: CoachPerson[] }
export interface VolumeData { weeks: string[]; athletes: VolumeRow[] }
export interface FeedbackData { items: FeedbackItem[] }
export interface WeekData {
  weekStart: string;
  plan: { status: 'none' | 'draft' | 'partial' | 'pushed'; createdAt: string | null };
  days: Array<{ dayOfWeek: number; date: string; sessions: Array<{ name: string; km: number; optional: boolean }>; team: boolean; daySession: { title: string; startTime: string | null } | null }>;
  teamDays: number[];
  workoutHour: number;
}
export interface WatchData { runners: Array<{ athleteId: string; days: WatchCell[] }>; noWatch: Array<{ athleteId: string }>; planDays: number[] }

export const usePeople = () => useApi<PeopleData>('/api/admin/people');
export const useVolume = (weeks = 10) => useApi<VolumeData>(`/api/coach/volume?weeks=${weeks}`);
export const useFeedback = () => useApi<FeedbackData>('/api/workout-feedback?list=1&days=30');

/** The plan week (Sunday) the club is standing in, the setup of it, and its watch send. */
export function useWeek(weekStart = planWeekStartOf()) {
  const week = useApi<WeekData>(`/api/week-setup?week=${weekStart}`);
  const plans = useApi<{ plans: Array<{ id: string; status: string }> }>(`/api/plans?coach_id=${COACH_ID}&week_start_date=${weekStart}`);
  const planId = plans.data?.plans?.[0]?.id ?? null;
  const watch = useApi<WatchData>(planId ? `/api/plans/watch-status?planId=${planId}&weekStart=${weekStart}` : null);
  return { weekStart, week, watch, planId };
}

/** Feedback with pain in the last 14 days → the runners the "כאב" chip finds. */
export function painIds(items: FeedbackItem[] | undefined, today = israelToday()): Set<string> {
  const from = new Date(`${today}T12:00:00`);
  from.setDate(from.getDate() - 14);
  const since = from.toISOString().slice(0, 10);
  return new Set((items || []).filter((i) => i.pain === true && i.createdAt.slice(0, 10) >= since).map((i) => i.athleteId));
}

// ── the gate and the runner card ────────────────────────────────────────────────────

const RunnerCtx = createContext<(id: string) => void>(() => {});
/** Open the runner card for an athlete id, from any tab. */
export const useOpenRunner = () => useContext(RunnerCtx);

export function CoachSpaceShell({ children }: { children: React.ReactNode }) {
  const identity = useNavIdentity();
  const space = useCoachSpace(identity);
  const [runnerId, setRunnerId] = useState<string | null>(null);
  const open = useMemo(() => (id: string) => setRunnerId(id), []);

  if (!identity.ready || !space.known) return <div className="pt-16"><Loading /></div>;
  if (!space.open) {
    return (
      <div className="px-4 pt-16">
        <EmptyState title="אזור המאמן עוד כבוי" description="המנהל מדליק אותו בהגדרות" />
        <Link href="/dashboard/coach-tools" className="mx-auto mt-4 flex min-h-[44px] w-fit items-center rounded-full bg-card px-5 text-sm font-bold text-brand-600">לניהול</Link>
      </div>
    );
  }
  return (
    <RunnerCtx.Provider value={open}>
      {!space.on && (
        <p className="mx-4 mt-2 rounded-[14px] bg-[#FFF4E5] px-3 py-2 text-[12.5px] font-semibold text-[#7A3E06]">תצוגה מקדימה — אזור המאמן כבוי לכולם</p>
      )}
      {/* The switch itself, here where it is being judged (admin/super user only — the row hides itself otherwise). */}
      <div className="mx-4 mt-2 overflow-hidden rounded-[14px] bg-card empty:hidden"><CoachSpaceSwitchRow /></div>
      <div className="pb-28">{children}</div>
      <Sheet open={!!runnerId} onOpenChange={(o) => { if (!o) setRunnerId(null); }} title="כרטיס רץ">
        {runnerId && <RunnerCard athleteId={runnerId} />}
      </Sheet>
    </RunnerCtx.Provider>
  );
}

/** A session line ("50–70 דק׳ · 4:40–5:15"): each number run, ranges included, kept left-to-right. */
export function SessionText({ text }: { text: string }) {
  const parts = text.split(/(\d[\d:.,×]*(?:\s*[–→-]\s*\d[\d:.,×]*)*)/);
  return <>{parts.map((p, i) => (i % 2 ? <bdi key={i} dir="ltr">{p}</bdi> : p))}</>;
}
