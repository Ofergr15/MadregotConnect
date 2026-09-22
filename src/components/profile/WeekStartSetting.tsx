'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SegmentedControl } from '@/components/ui';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { MONDAY_WEEK, SUNDAY_WEEK, type WeekStartDay } from '@/lib/utils';

/**
 * WHICH DAY MY WEEK STARTS ON.
 *
 * Reported by Sahar (feedback 75cb7ec7): the app's week runs Monday to Sunday and
 * he reads his week the Israeli way, ending on Saturday. Monday is not an accident
 * — it is the week a Garmin reports, and the app deliberately matches it so a
 * weekly total can be reconciled against the watch that produced it. But it is
 * also not the only right answer, so this is the member's own switch.
 *
 * WHAT IT MOVES: the numbers on this profile — the weekly km chart, "this week",
 * the trend badge.
 *
 * WHAT IT DOES NOT MOVE, and the note under the control says so out loud: the
 * leaderboard and the pack war. Those rank twenty-five people and have to measure
 * all of them over the same seven days, so they stay Monday–Sunday for everybody
 * (Ofer's call). Saying that here is the whole reason the setting is safe to offer:
 * without it, a member who switches to Sunday and then sees a different km on the
 * leaderboard has found a bug rather than a preference.
 *
 * Optimistic, and silently reverts on failure rather than raising an error — the
 * control shows what is saved, and a toast about a display preference is more
 * interruption than the thing is worth.
 */
export function WeekStartSetting({ athleteId, value, onSaved }: {
  athleteId: string;
  value: WeekStartDay;
  onSaved?: (v: WeekStartDay) => void;
}) {
  const t = useTranslations('profile');
  const [day, setDay] = useState<WeekStartDay>(value);
  const [saving, setSaving] = useState(false);

  const pick = async (next: WeekStartDay) => {
    if (next === day || saving) return;
    const previous = day;
    setDay(next);
    setSaving(true);
    try {
      const res = await fetch('/api/athletes/me', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ id: athleteId, weekStartDay: next }),
      });
      if (!res.ok) throw new Error('save failed');
      onSaved?.(next);
    } catch {
      setDay(previous);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 pt-1">
      <SegmentedControl<'monday' | 'sunday'>
        value={day === SUNDAY_WEEK ? 'sunday' : 'monday'}
        onChange={(v) => pick(v === 'sunday' ? SUNDAY_WEEK : MONDAY_WEEK)}
        options={[
          { value: 'monday', label: t('weekMonSun') },
          { value: 'sunday', label: t('weekSunSat') },
        ]}
      />
      <p className="mt-1.5 text-2xs leading-relaxed text-ink-400">{t('weekStartNote')}</p>
    </div>
  );
}
