'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { Sheet, Spinner } from '@/components/ui';
import { EMPTY_GOAL, readGoal, type Goal } from '@/lib/academy/goal';
import { GoalSheet, goalSummary } from '@/components/academy/completion/GoalSheet';
import { sendJson } from '@/components/academy/completion/shared';

// "4 שאלות קצרות" (migration plan, screen t5): the part of the characterization call an
// existing trainee never had — which days, roughly how many km a week, the goal, and any
// limitations. On the trainee's academy home until it is answered; the answers land on their
// card's characterization, where the plan composer already reads them, and their coaches are told.

interface SelfAnswers { availableDays: number[]; weeklyKm: number | null; limitations: string | null; answered: boolean; suggestedWeeklyKm: number | null }
interface GoalRead { goal: Goal }

const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export function QuickQuestionsCard({ athleteId }: { athleteId: string }) {
  const { data, mutate } = useApi<SelfAnswers>('/api/academy/characterization/self');
  const { data: goalRead, mutate: mutateGoal } = useApi<GoalRead>(`/api/academy/goal?athleteId=${encodeURIComponent(athleteId)}`);
  const [open, setOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [km, setKm] = useState('');
  const [limits, setLimits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !data) return;
    setDays(data.availableDays);
    setKm(data.weeklyKm != null ? String(data.weeklyKm) : data.suggestedWeeklyKm != null ? String(data.suggestedWeeklyKm) : '');
    setLimits(data.limitations ?? '');
    setError(null);
  }, [open, data]);

  if (!data || data.answered) return null;
  const goal = goalRead?.goal ? readGoal(goalRead.goal as unknown as Record<string, unknown>) : EMPTY_GOAL;
  const goalText = goalSummary(goal);
  const kmNum = km.trim() ? Number(km.replace(',', '.')) : NaN;
  const kmOk = Number.isFinite(kmNum) && kmNum >= 0 && kmNum <= 400;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await sendJson('PUT', '/api/academy/characterization/self', { availableDays: days, weeklyKm: kmNum, limitations: limits });
      setOpen(false);
      await mutate();
    } catch (e) {
      setError((e as Error).message || 'השמירה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const saveGoal = async (g: Goal) => {
    await sendJson('PUT', '/api/academy/goal', { athleteId, ...g }).catch(() => {});
    setGoalOpen(false);
    await mutateGoal();
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full min-h-[64px] items-center gap-3 rounded-[22px] bg-white px-4 py-3 text-start shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600/10 text-lg" aria-hidden>📝</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-extrabold text-ink-900">4 שאלות קצרות</span>
          <span className="block text-xs text-ink-400">דקה אחת · במקום שיחת אפיון · כדי שהמאמן יבנה שבוע שמתאים לך</span>
        </span>
        <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="4 שאלות קצרות"
        footer={(
          <div className="px-4 pb-3 pt-1">
            <button type="button" onClick={() => void save()} disabled={busy || !days.length || !kmOk}
              className="flex w-full min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-brand-600 text-base font-extrabold text-white disabled:opacity-50">
              {busy && <Spinner size={16} tone="ink" />}לשלוח למאמן
            </button>
            {error && <p className="px-1 pt-1 text-[13px] font-bold text-accent-red-ink" role="alert">{error}</p>}
          </div>
        )}>
        <div className="space-y-4" dir="rtl">
          <p className="px-1 text-[13px] leading-relaxed text-ink-400">אותו דבר ששואלים בשיחת אפיון — כדי שהמאמן יבנה שבוע שמתאים לך.</p>
          <div>
            <p className="mb-2 px-1 text-[15px] font-bold text-ink-900">באילו ימים אפשר להתאמן?</p>
            <div className="flex gap-1.5" role="group" aria-label="ימי אימון">
              {DAYS.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setDays((v) => (on ? v.filter((x) => x !== i) : [...v, i].sort()))}
                    className={cn('flex h-11 flex-1 items-center justify-center rounded-xl text-[14px] font-extrabold', on ? 'bg-brand-600 text-white' : 'bg-[#F0F0F4] text-ink-500')}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 px-1 text-[15px] font-bold text-ink-900">כמה ק״מ בשבוע בערך היום?</p>
            <div className="flex min-h-[50px] items-center gap-2 rounded-xl bg-[#F0F0F4] px-3">
              <input value={km} onChange={(e) => setKm(e.target.value)} inputMode="decimal" dir="ltr" placeholder="40"
                className="h-11 w-24 bg-transparent text-end text-[18px] font-extrabold text-ink-900 placeholder:text-ink-300 focus:outline-none" />
              <span className="text-sm font-bold text-ink-500">ק״מ בשבוע</span>
            </div>
            {data.suggestedWeeklyKm != null && (
              <p className="mt-1 px-1 text-[12px] text-ink-400">לפי השעון: <bdi dir="ltr">{data.suggestedWeeklyKm}</bdi> ק״מ בממוצע ב־4 השבועות האחרונים</p>
            )}
          </div>
          <div>
            <p className="mb-2 px-1 text-[15px] font-bold text-ink-900">המטרה הקרובה</p>
            <button type="button" onClick={() => setGoalOpen(true)} className="flex w-full min-h-[56px] items-center gap-3 rounded-xl bg-[#F0F0F4] px-3 text-start">
              <Trophy className="h-5 w-5 shrink-0 text-brand-600" />
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold text-ink-900" dir="auto">{goalText || 'לבחור מרוץ או מטרה'}</span>
              <span className="text-[13px] font-extrabold text-brand-600">{goalText ? 'שינוי' : 'לבחור'}</span>
            </button>
          </div>
          <div>
            <p className="mb-2 px-1 text-[15px] font-bold text-ink-900">פציעות או מגבלות? <span className="font-normal text-ink-400">(לא חובה)</span></p>
            <textarea value={limits} onChange={(e) => setLimits(e.target.value)} rows={2} maxLength={500} placeholder="למשל: ברך ימין, לא בירידות…" dir="auto"
              className="w-full resize-none rounded-xl bg-[#F0F0F4] px-3 py-2.5 text-[15px] text-ink-900 placeholder:text-ink-300 focus:outline-none" />
          </div>
        </div>
      </Sheet>
      <GoalSheet open={goalOpen} onOpenChange={setGoalOpen} goal={goal} athleteId={athleteId} onDone={(g) => void saveGoal(g)} />
    </>
  );
}
