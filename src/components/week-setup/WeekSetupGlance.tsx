'use client';

import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { israelToday } from '@/lib/utils';
import { addDays } from '@/lib/week-setup/model';
import { mineOf, weekOfAction, type LogEntry, type Step } from '@/lib/week-setup/log';
import type { WeekSnapshot } from '@/lib/week-setup/server';
import { dm } from './parts';

/**
 * The week's setup at a glance, on the management page (Ofer, 10-24: "it has to be on the
 * management page — mine and the admin's", and "think what Yair sees"): how far it is, the
 * next step, and the last two lines of who did what. An admin counts all seven steps; a
 * coach their own part. A tap opens the screen. Nothing when the week can't be read.
 */
export function WeekSetupGlance() {
  const t = useTranslations('weekSetup');
  const lang = useLocale().startsWith('en') ? 'en' : 'he';
  const week = weekOfAction(israelToday());
  const { data } = useApi<WeekSnapshot & { me: { admin: boolean }; mine: Step[] }>(`/api/week-setup?week=${week}`);
  if (!data) return null;
  const r = data.me.admin ? data.readiness : mineOf(data.readiness, data.mine);
  const ready = !r.next;
  const C = 2 * Math.PI * 17;
  const when = (iso: string) => new Date(iso).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const lines = [...data.log].reverse().slice(0, 2);
  const line = (e: LogEntry) => `${e.name.trim().split(/\s+/)[0]} · ${t(`act_${e.action}`)}${e.detail ? ` · ${e.detail}` : ''}`;
  return (
    <Link href={`/dashboard/week?week=${week}`} className="mb-3 flex items-center gap-3 rounded-[20px] bg-card px-3.5 py-3 active:opacity-80" dir="rtl">
      <span className="relative h-11 w-11 shrink-0">
        <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden>
          <circle cx="22" cy="22" r="17" fill="none" stroke="#EEF0F6" strokeWidth="5" />
          <circle cx="22" cy="22" r="17" fill="none" stroke={ready ? '#15803d' : '#1525FF'} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${(C * r.done) / Math.max(1, r.total)} 999`} transform="rotate(-90 22 22)" />
        </svg>
        <b className="absolute inset-0 grid place-items-center text-[12px] font-black text-ink-900"><bdi dir="ltr">{r.done}/{r.total}</bdi></b>
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[15px] font-extrabold text-ink-900">{t('glanceTitle')} · <bdi dir="ltr">{Number(week.slice(8, 10))}–{dm(addDays(week, 6))}</bdi></b>
        <span className={`block text-[12.5px] font-bold ${ready ? 'text-[#15803d]' : 'text-brand-600'}`}>
          {ready ? (data.me.admin ? t('glanceAll') : t('mineDone')) : t('next', { what: t(`miss_${r.next}`) })}
        </span>
        {lines.map((e, i) => (
          <span key={`${e.at}-${i}`} className="block truncate text-[12px] text-ink-400"><bdi dir="ltr">{when(e.at)}</bdi> · {line(e)}</span>
        ))}
      </span>
      <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300 ltr:rotate-180" />
    </Link>
  );
}
