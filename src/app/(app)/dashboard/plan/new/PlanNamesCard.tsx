'use client';

import { useState } from 'react';
import type { ParsedWorkout } from '@/lib/ai/types';
import { nameOf, nameSuggestions, suggestedName } from '@/lib/plans/plan-names';
import { cn } from '@/lib/utils';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * "שמות האימונים" (mockup ~/.cache/madregot/plan-names): how each session will read to the
 * runners — card, share, search. Built from the steps, approved once, editable per session.
 * Every change is written to the plan straight away (onChange → the page's persistPlan).
 */
export function PlanNamesCard({ workouts, weekStartDate, onChange, onChangeAll }: {
  workouts: ParsedWorkout[];
  weekStartDate: string;
  onChange: (index: number, workout: ParsedWorkout) => void;
  /** One write for "approve all" — a loop of onChange would each start from the same old plan. */
  onChangeAll: (workouts: ParsedWorkout[]) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const rows = workouts.map((w, i) => ({ w, i })).filter(({ w }) => (w.steps?.length ?? 0) > 0);
  if (!rows.length) return null;
  const pending = rows.filter(({ w }) => !w.workoutName);
  const dateOf = (dow: number) => {
    const d = new Date(`${weekStartDate}T12:00:00`);
    d.setDate(d.getDate() + dow);
    return d.getDate();
  };
  const save = (i: number, name: string) => {
    const v = name.trim();
    if (v) onChange(i, { ...workouts[i], workoutName: v });
    setEditing(null);
  };

  return (
    <section className="mb-4 overflow-hidden rounded-[20px] bg-card" dir="rtl">
      <div className="px-4 pb-2 pt-3.5">
        <h3 className="text-[16px] font-black text-ink-900">שמות האימונים</h3>
        <p className="mt-0.5 text-13 leading-relaxed text-ink-500">כך יופיע כל אימון אצל הרצים — בכרטיס, בשיתוף ובחיפוש. מאשרים פעם אחת, וזה השם שהריצה תקבל.</p>
      </div>
      {rows.map(({ w, i }) => {
        const auto = suggestedName(w);
        const changed = !!w.workoutName && w.workoutName !== auto;
        return (
          <div key={i} className="border-t-[0.5px] border-black/[0.08] px-4 py-2.5">
            <div className="flex items-center gap-3">
              <span className="w-10 shrink-0 text-center text-12 font-extrabold text-ink-400">{DAYS[w.dayOfWeek]}<b className="block text-[18px] text-ink-900">{dateOf(w.dayOfWeek)}</b></span>
              <span className="min-w-0 flex-1">
                <bdi className="text-[15.5px] font-extrabold text-ink-900">{nameOf(w)}</bdi>
                <span className={cn('ms-1.5 rounded-md px-1.5 py-px text-[11px] font-extrabold',
                  changed ? 'bg-[#fff3df] text-[#b26a00]' : w.workoutName ? 'bg-[#E8F7EE] text-[#15803d]' : 'bg-page text-ink-500')}>
                  {changed ? 'שונה ידנית' : w.workoutName ? 'אושר' : 'אוטומטי'}
                </span>
                {changed && <small className="block text-12 text-ink-400">היה: <bdi>{auto}</bdi></small>}
              </span>
              <button type="button" onClick={() => { setEditing(editing === i ? null : i); setDraft(nameOf(w)); }}
                className="min-h-[36px] px-1 text-[14px] font-bold text-[#007aff]">עריכה</button>
            </div>
            {editing === i && (
              <div className="mt-2 space-y-2">
                <input value={draft} onChange={(e) => setDraft(e.target.value)} dir="auto" autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') save(i, draft); }}
                  className="w-full rounded-[12px] border-2 border-[#007aff] px-3 py-2.5 text-[17px] font-extrabold text-ink-900 outline-none" />
                <div className="flex flex-wrap gap-1.5">
                  {nameSuggestions(w).map((s) => (
                    <button key={s} type="button" onClick={() => setDraft(s)} className="min-h-[32px] rounded-full bg-page px-3 text-13 font-bold text-ink-700"><bdi>{s}</bdi></button>
                  ))}
                  <button type="button" onClick={() => save(i, draft)} className="ms-auto min-h-[32px] rounded-full bg-ink-900 px-4 text-13 font-extrabold text-white">שמירה</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {pending.length > 0 && (
        <div className="px-4 pb-3.5 pt-1">
          <button type="button" onClick={() => onChangeAll(workouts.map((w) => (w.workoutName || !(w.steps?.length) ? w : { ...w, workoutName: suggestedName(w) })))}
            className="min-h-[48px] w-full rounded-[14px] bg-ink-900 text-[15px] font-black text-white">✓ לאשר את השמות</button>
        </div>
      )}
    </section>
  );
}
