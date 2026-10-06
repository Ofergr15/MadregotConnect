'use client';

// The week's quality days on the plan screen (super user): one row of the seven
// days to tap, a nudge for a day that has a set but was saved optional (week of
// 2026-10-04: Tuesday's 3 sets, kept optional by its "evening strength" note),
// and the line saying which mornings get the 7:30 push. Saved to
// /api/quality-session/plan-days; the quality screen and the push read the same pick.

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import type { WeekQuality } from '@/lib/quality-session/plan-days';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export interface QualityDaysState {
  q: WeekQuality | null;
  saving: boolean;
  error: boolean;
  toggle: (dow: number) => void;
}

/** `version` reloads it: a re-parsed or edited plan changes what is detected. */
export function useQualityDays(week: string, enabled: boolean, version: unknown): QualityDaysState {
  const [q, setQ] = useState<WeekQuality | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setQ(null);
    (async () => {
      const res = await fetch(`/api/quality-session/plan-days?week=${week}`, { headers: await bearerHeaders(false) });
      if (live && res.ok) setQ(await res.json());
    })().catch(() => {});
    return () => { live = false; };
  }, [week, enabled, version]);

  const toggle = useCallback((dow: number) => {
    if (!q || saving) return;
    const next = q.days.includes(dow) ? q.days.filter(d => d !== dow) : [...q.days, dow].sort();
    // Back to the plan's own answer when the pick matches it, so a later re-parse is followed again.
    const same = next.length === q.auto.length && next.every(d => q.auto.includes(d));
    setQ({ ...q, days: next, manual: !same });
    setSaving(true);
    setError(false);
    (async () => {
      const res = await fetch('/api/quality-session/plan-days', {
        method: 'PUT', headers: await bearerHeaders(true), body: JSON.stringify({ week, days: same ? null : next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setQ(await res.json());
    })().catch(() => { setError(true); setQ(q); }).finally(() => setSaving(false));
  }, [q, saving, week]);

  return { q, saving, error, toggle };
}

export function QualityDaysCard({ state }: { state: QualityDaysState }) {
  const { q, saving, error, toggle } = state;
  const [dismissed, setDismissed] = useState<number[]>([]);
  if (!q) return null;
  const nudge = q.suggested.find(d => !q.days.includes(d) && !dismissed.includes(d));
  const picked = q.days.map(d => DAYS[d]);

  return (
    <div className="mb-4 space-y-2">
      <div className="rounded-2xl bg-card p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-ink-700">⭐ אימוני איכות השבוע</h3>
          {saving && <span className="text-2xs text-ink-400">שומר…</span>}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          הימים האלה מקבלים את מסך אימון האיכות ואת ההתראה של 7:30. לחיצה מסמנת או מורידה.
        </p>
        <div className="mt-2 flex gap-1.5" dir="rtl">
          {SHORT.map((label, dow) => {
            const on = q.days.includes(dow), sug = !on && q.suggested.includes(dow);
            return (
              <button
                key={dow}
                type="button"
                onClick={() => toggle(dow)}
                aria-pressed={on}
                aria-label={`${DAYS[dow]}${on ? ', אימון איכות' : ''}`}
                className={cn(
                  'min-h-[44px] flex-1 rounded-xl text-xs font-extrabold transition-colors',
                  on ? 'bg-[#FF5A28] text-white'
                    : sug ? 'border-[1.5px] border-dashed border-[#FF5A28] bg-[#FFF1E8] text-[#c2410c]'
                      : 'bg-page text-ink-400',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs font-bold text-ink-700">
          {picked.length ? `📸 ${picked.join(', ')} · התראה ב-7:30` : 'אין השבוע אימון איכות'}
          <span className="ms-1.5 font-normal text-ink-400">{q.manual ? '· סימנת ידנית' : '· זוהה מהתוכנית'}</span>
        </p>
        {error && <p className="mt-1 text-xs font-bold text-accent-red">לא הצלחתי לשמור. לנסות שוב.</p>}
      </div>

      {nudge !== undefined && (
        <div className="rounded-xl bg-[#FFF7ED] p-3 text-xs leading-relaxed text-[#7c2d12]">
          <b className="block text-[13px]">{DAYS[nudge]} נראה כמו אימון איכות</b>
          יש בו סט חזרות, אבל הוא לא זוהה. לרוב כי הוא נשמר כ{'"אופציה"'} בגלל הערה בתוכנית.
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => toggle(nudge)}
              className="min-h-[40px] flex-1 rounded-lg bg-brand-600 text-xs font-extrabold text-white">
              ⭐ לסמן כאימון איכות
            </button>
            <button type="button" onClick={() => setDismissed(d => [...d, nudge])}
              className="min-h-[40px] flex-1 rounded-lg border border-page bg-card text-xs font-extrabold text-brand-600">
              לא, הוא אופציה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The chip on the day's own header in the week list. */
export function QualityDayChip({ state, dow }: { state: QualityDaysState; dow: number }) {
  const { q, toggle } = state;
  if (!q) return null;
  const on = q.days.includes(dow);
  return (
    <button
      type="button"
      onClick={() => toggle(dow)}
      aria-pressed={on}
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-2xs font-extrabold',
        on ? 'bg-[#FF5A28] text-white' : 'bg-page text-ink-400',
      )}
    >
      ⭐ איכות
    </button>
  );
}
