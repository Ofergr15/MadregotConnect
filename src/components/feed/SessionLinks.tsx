'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { Sheet } from '@/components/ui';
import type { DaySessionMark } from '@/lib/ai/types';
import { planLinks, type DaySession, type NutritionWhen, type ProgramWeekLike } from '@/lib/day-session/model';

// Under the next-session card and in its sheet (mockup publish, A1–A3): the week's training
// plan and nutrition plan — only when they exist, nothing grey in their place — and, for a
// one-day session, the nutrition the coach wrote for that session.

const FOOD_ICON: Record<NutritionWhen, string> = { before: '🍌', during: '💧', after: '🥤' };

export function SessionLinks({ weekStart, hasClubPlan, daySession }: { weekStart: string; hasClubPlan: boolean; daySession?: DaySessionMark }) {
  const t = useTranslations('daySession');
  const { data: weeks } = useApi<ProgramWeekLike[]>('/api/program-weeks');
  const { data: feed } = useApi<{ sessions: DaySession[] }>(daySession?.hasNutrition ? '/api/day-session' : null);
  const [foodOpen, setFoodOpen] = useState(false);
  const links = planLinks(weekStart, { hasPlan: hasClubPlan }, weeks);
  const food = daySession ? feed?.sessions?.find((s) => s.date === daySession.date)?.nutrition ?? [] : [];
  if (!links.weekly && !links.nutrition && !food.length) return null;

  const chip = 'flex min-h-[46px] flex-1 items-center justify-center gap-1.5 rounded-[14px] px-2 text-sm font-extrabold active:opacity-80';
  return (
    <>
      {(links.weekly || links.nutrition) && (
        <div className="flex gap-2">
          {links.weekly && <Link href={links.weekly.href} className={`${chip} bg-brand-600/10 text-brand-600`}>📋 {t('weeklyPlan')}</Link>}
          {links.nutrition && <Link href={links.nutrition.href} className={`${chip} bg-[#E4F6F0] text-[#0B7258]`}>🥗 {t('nutritionPlan')}</Link>}
        </div>
      )}
      {food.length > 0 && (
        <button type="button" onClick={() => setFoodOpen(true)} className={`${chip} w-full bg-[#FFF4DB] text-[#8A5A00]`}>🍽️ {t('foodForThis')}</button>
      )}
      <Sheet open={foodOpen} onOpenChange={setFoodOpen} title={t('nutrition')}>
        <div dir="rtl" className="overflow-hidden rounded-[18px] bg-white">
          {food.map((l, i) => (
            <div key={i} className="flex items-start gap-2.5 border-b border-[#EFEFF4] px-3.5 py-2.5 last:border-0">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#E4F6F0] text-base">{FOOD_ICON[l.when]}</span>
              <span className="min-w-0">
                <b className="block text-13 font-extrabold text-[#0B7258]">{t(l.when)}</b>
                <span className="block text-[15px] leading-snug text-ink-900">{l.text}</span>
              </span>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}

/** A one-day session's notes, for its sheet. */
export function DaySessionNotes({ daySession }: { daySession?: DaySessionMark }) {
  const t = useTranslations('daySession');
  if (!daySession?.notes) return null;
  return (
    <div className="rounded-2xl bg-page px-3.5 py-3">
      <p className="text-xs font-bold text-ink-400">{t('description')}</p>
      <p dir="auto" className="mt-1 whitespace-pre-line text-[15px] leading-snug text-ink-700">{daySession.notes}</p>
    </div>
  );
}
