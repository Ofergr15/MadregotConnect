'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { apiHeaders } from '@/lib/api';

/**
 * Manual activity entry — the fallback for athletes with neither Strava nor
 * Garmin connected (see CLAUDE.md task brief). Matches the fields that
 * already exist on `athlete_activities` (date/time -> start_time, distance,
 * duration); everything else (average_pace, source='manual', the
 * garmin_activity_id sentinel) is derived server-side in
 * /api/athletes/activities/manual.
 */

const ACTIVITY_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running'] as const;

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowLocalTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ManualActivitySheet({
  open,
  onOpenChange,
  athleteId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  athleteId: string;
  onSaved: () => void;
}) {
  const t = useTranslations('activities');
  const tc = useTranslations('common');

  const [date, setDate] = useState(todayLocalDate);
  const [time, setTime] = useState(nowLocalTime);
  const [distanceKm, setDistanceKm] = useState('');
  const [durationText, setDurationText] = useState('');
  const [activityName, setActivityName] = useState('');
  const [activityType, setActivityType] = useState<typeof ACTIVITY_TYPES[number]>('running');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accepts "mm:ss" or "hh:mm:ss".
  const parseDuration = (value: string): number | null => {
    const parts = value.trim().split(':').map(p => Number(p));
    if (parts.some(p => !Number.isFinite(p) || p < 0)) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  };

  const reset = () => {
    setDate(todayLocalDate());
    setTime(nowLocalTime());
    setDistanceKm('');
    setDurationText('');
    setActivityName('');
    setActivityType('running');
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    const distance = Number(distanceKm);
    const durationSeconds = parseDuration(durationText);

    if (!date) { setError(t('manualErrorMissingDate')); return; }
    if (!Number.isFinite(distance) || distance <= 0) { setError(t('manualErrorMissingDistance')); return; }
    if (!durationSeconds || durationSeconds <= 0) { setError(t('manualErrorMissingDuration')); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/athletes/activities/manual', {
        method: 'POST',
        // The route gates athleteId on the verified session now — a manual run
        // writes into someone's real training history, so it needs credentials.
        headers: await apiHeaders(true),
        body: JSON.stringify({
          athleteId,
          date,
          time,
          distanceKm: distance,
          durationSeconds,
          activityName,
          activityType,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || t('manualError'));
      }
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('manualError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!next) { reset(); } onOpenChange(next); }}
      title={t('logManualActivity')}
    >
      <div className="space-y-4 pb-2">
        <p className="text-sm text-ink-400">{t('manualEntryHint')}</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-400 mb-1.5">{t('date')}</label>
            <input
              type="date"
              value={date}
              max={todayLocalDate()}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-page/50 border border-page/50 text-sm text-ink-700 focus:outline-none focus:border-brand-600/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-400 mb-1.5">{t('time')}</label>
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-page/50 border border-page/50 text-sm text-ink-700 focus:outline-none focus:border-brand-600/50"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-400 mb-1.5">{t('distanceKm')}</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              placeholder="10.0"
              value={distanceKm}
              onChange={e => setDistanceKm(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-page/50 border border-page/50 text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:border-brand-600/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-400 mb-1.5">
              {t('durationLabel')} <span className="text-ink-400">({t('durationHint')})</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="45:00"
              value={durationText}
              onChange={e => setDurationText(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-page/50 border border-page/50 text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:border-brand-600/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-400 mb-1.5">{t('activityTypeLabel')}</label>
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setActivityType(type)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  activityType === type
                    ? 'border-brand-600 bg-brand-600/10 text-white'
                    : 'border-page text-ink-400 hover:text-ink-700'
                }`}
              >
                {t(`activityType_${type}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-400 mb-1.5">{t('activityName')}</label>
          <input
            type="text"
            placeholder={t('activityNamePlaceholder')}
            value={activityName}
            onChange={e => setActivityName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-page/50 border border-page/50 text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:border-brand-600/50"
          />
        </div>

        {error && <p className="text-sm text-accent-red">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => { reset(); onOpenChange(false); }}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-ink-400 hover:text-ink-900 transition-colors"
          >
            {tc('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? t('savingActivity') : t('saveActivity')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
