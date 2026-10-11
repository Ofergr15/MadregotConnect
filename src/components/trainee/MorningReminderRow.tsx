'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiHeaders } from '@/lib/api';
import { Switch } from '@/components/ui';
import { RICH } from './ui';

// ── ⏰ תזכורת בוקר (trainee-experience-v2 screen 9, the setting) ─────────────────────────
//
// On a workout day, at the time chosen here, a push says what to run, at what pace, and
// whether it is on the watch (lib/academy/morning-reminder.ts). The time is on the cron
// tick's 5-minute grid — two pickers, hours and minutes in steps of 5, rather than a time
// input whose step iOS ignores. Saved through PATCH /api/athletes/notification-prefs,
// which keeps every other preference as it was. From 12:00 the reminder is about tomorrow.

export interface MorningReminderValue {
  enabled: boolean;
  time: string;
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const SELECT = 'h-11 min-w-[56px] rounded-xl bg-[#F1F2F7] px-2 text-center text-[15px] font-extrabold text-ink-900 disabled:opacity-40';

export function MorningReminderRow({ athleteId, value, onSaved, pushOn = true }: {
  athleteId: string;
  value: MorningReminderValue;
  onSaved?: (next: MorningReminderValue) => void;
  /** Push is allowed on this device. Off: the reminder would reach the inbox only, and it says so. */
  pushOn?: boolean;
}) {
  const t = useTranslations('trainee.reminder.setting');
  const [state, setState] = useState<MorningReminderValue>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [hh, mm] = state.time.split(':');

  const save = async (patch: Partial<MorningReminderValue>) => {
    const prev = state;
    const next = { ...state, ...patch };
    setState(next);
    setSaving(true);
    setError(false);
    try {
      const res = await fetch('/api/athletes/notification-prefs', {
        method: 'PATCH',
        headers: { ...(await apiHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId, morningReminder: patch }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json().catch(() => null);
      const saved = (data?.morningReminder as MorningReminderValue | undefined) ?? next;
      setState(saved);
      onSaved?.(saved);
    } catch {
      setState(prev);
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex min-h-[44px] items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-ink-700">{t('title')}</span>
          <span className="block text-xs leading-snug text-ink-400">{t('sub')}</span>
        </span>
        <Switch checked={state.enabled} onChange={() => save({ enabled: !state.enabled })} disabled={saving} activeColor="bg-accent-600" ariaLabel={t('toggleAria')} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-13 text-ink-500">{t('time')}</span>
        <div dir="ltr" className="flex items-center gap-1" role="group" aria-label={t('timeAria')}>
          <select aria-label={`${t('timeAria')} (HH)`} value={hh} disabled={saving || !state.enabled} className={SELECT}
            onChange={e => save({ time: `${e.target.value}:${mm}` })}>
            {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
          <span className="text-[15px] font-extrabold text-ink-400">:</span>
          <select aria-label={`${t('timeAria')} (MM)`} value={MINUTES.includes(mm) ? mm : '00'} disabled={saving || !state.enabled} className={SELECT}
            onChange={e => save({ time: `${hh}:${e.target.value}` })}>
            {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      {Number(hh) >= 12 && state.enabled && <p className="mt-1.5 text-xs text-ink-400">{t.rich('evening', RICH)}</p>}
      {state.enabled && !pushOn && <p className="mt-1.5 text-xs font-bold text-[#A8510A]">{t('noPush')}</p>}
      {error && <p className="mt-1.5 text-xs text-accent-red">{t('saveError')}</p>}
    </div>
  );
}
