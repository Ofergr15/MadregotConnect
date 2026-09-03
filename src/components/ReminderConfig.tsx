'use client';

import { useState, useEffect } from 'react';
import { Bell, Loader2, Check, ChevronDown, CheckCircle2, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Sheet, Switch } from '@/components/ui';
import { apiHeaders } from '@/lib/api';

interface Cfg {
  teamDays: number[];
  dayBefore: { enabled: boolean; hour: number };
  eveningBefore: { enabled: boolean; hour: number };
  workoutHour?: number; // team workout start (IL); drives the RSVP cutoff
  // Where the team meets. Free text — the club moves between the stairs, the
  // park and the track, and there's no venue table to point at. Needs no
  // migration or route change: `reminder_config` is a JSON value column, GET
  // spreads whatever is stored over DEFAULT, and PUT persists whatever object
  // it's handed. Read by the Profile screen's מיקום column, which hides itself
  // while this is unset rather than showing an invented default.
  location?: string;
}
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']; // Sun..Sat (Hebrew initials)

type PickerTarget = 'dayBefore' | 'eveningBefore' | 'workoutHour' | null;

export function ReminderConfig() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);
  // Held as a draft rather than saved per keystroke — a PUT per character would
  // be 20 writes to app_settings for one place name.
  const [locDraft, setLocDraft] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/reminder-config').then(r => r.ok ? r.json() : null).then(d => setCfg(d?.config || null)).catch(() => {});
  }, []);

  const save = async (next: Cfg) => {
    setCfg(next);
    setSaving(true);
    try {
      const res = await fetch('/api/reminder-config', {
        method: 'PUT', headers: await apiHeaders(true),
        body: JSON.stringify({ config: next }),
      });
      if (res.ok) { setFlash(true); setTimeout(() => setFlash(false), 1500); }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  if (!cfg) return null;

  const toggleDay = (d: number) => {
    const has = cfg.teamDays.includes(d);
    save({ ...cfg, teamDays: has ? cfg.teamDays.filter(x => x !== d) : [...cfg.teamDays, d].sort() });
  };
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

  const setHour = (h: number) => {
    if (pickerFor === 'workoutHour') {
      save({ ...cfg, workoutHour: h });
    } else if (pickerFor === 'dayBefore' || pickerFor === 'eveningBefore') {
      save({ ...cfg, [pickerFor]: { ...cfg[pickerFor], hour: h } });
    }
    setPickerFor(null);
  };

  const currentHourForPicker =
    pickerFor === 'workoutHour' ? (cfg.workoutHour ?? 18)
      : pickerFor === 'dayBefore' || pickerFor === 'eveningBefore' ? cfg[pickerFor].hour
        : -1;

  const StageRow = ({ label, stage }: { label: string; stage: 'dayBefore' | 'eveningBefore' }) => {
    const enabled = cfg[stage].enabled;
    return (
      <InsetRow
        label={label}
        trailing={
          <div className="flex items-center gap-1">
            <Switch checked={enabled} onChange={() => save({ ...cfg, [stage]: { ...cfg[stage], enabled: !enabled } })} ariaLabel={label} />
            <button
              onClick={() => setPickerFor(stage)}
              disabled={!enabled}
              className="min-h-[44px] min-w-[44px] flex items-center gap-1 px-1.5 text-sm text-ink-500 disabled:opacity-40 tabular-nums"
            >
              {fmtHour(cfg[stage].hour)}
              <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
            </button>
          </div>
        }
      />
    );
  };

  return (
    <div dir="rtl" className="mb-6">
      {(saving || flash) && (
        <div className="flex items-center justify-end gap-1.5 px-1 mb-1.5">
          {saving && <Loader2 className="w-3.5 h-3.5 text-ink-400 animate-spin" />}
          {flash && <Check className="w-3.5 h-3.5 text-accent-600" />}
        </div>
      )}

      <InsetSection header={t('workoutReminders')}>
        <InsetRow
          icon={Bell}
          iconBg="bg-brand-600"
          label={t('teamWorkoutTime')}
          value={fmtHour(cfg.workoutHour ?? 18)}
          onClick={() => setPickerFor('workoutHour')}
        />
        <InsetRow
          icon={MapPin}
          iconBg="bg-teal-500"
          label={t('teamWorkoutLocation')}
          value={cfg.location?.trim() || t('notSet')}
          valueMuted={!cfg.location?.trim()}
          onClick={() => setLocDraft(cfg.location || '')}
        />
        <StageRow label={t('reminderDayBefore')} stage="dayBefore" />
        <StageRow label={t('reminderEveningBefore')} stage="eveningBefore" />
      </InsetSection>

      <div className="rounded-card border border-page/50 bg-card/50 p-4">
        <p className="text-xs font-semibold text-ink-400 mb-2">{t('teamWorkoutDays')}</p>
        <div className="flex gap-1.5 flex-wrap">
          {DAYS.map((d, i) => (
            <button key={i} onClick={() => toggleDay(i)}
              className={cn('min-w-[44px] min-h-[44px] rounded-lg text-xs font-bold transition',
                cfg.teamDays.includes(i) ? 'bg-brand-600 text-white' : 'bg-page/40 text-ink-400 hover:bg-ink-300/40')}>
              {d}
            </button>
          ))}
        </div>
        <p className="text-2xs text-ink-400 mt-3">{t('reminderFooterNote')}</p>
      </div>

      {/* Meeting place. Empty input = clear it, which puts the Profile screen's
          מיקום column back to hidden. */}
      <Sheet open={locDraft !== null} onOpenChange={(o) => !o && setLocDraft(null)} title={t('teamWorkoutLocation')}>
        <input
          value={locDraft ?? ''}
          onChange={e => setLocDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder={t('teamWorkoutLocationPlaceholder')}
          autoFocus
          dir="auto"
          className="w-full bg-page/50 border border-page rounded-lg px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
        <button
          onClick={() => { save({ ...cfg, location: (locDraft || '').trim() }); setLocDraft(null); }}
          className="mt-3 w-full min-h-[44px] rounded-xl bg-brand-600 text-sm font-bold text-white"
        >
          {tCommon('save')}
        </button>
      </Sheet>

      {/* Hour picker — a bottom sheet list, replacing the raw 24-option
          <select> (the least native-feeling way to pick a time on iOS). */}
      <Sheet open={pickerFor !== null} onOpenChange={(o) => !o && setPickerFor(null)} title={t('selectHour')}>
        <div className="rounded-2xl bg-page/40 overflow-hidden divide-y divide-page/50">
          {hours.map(h => {
            const isSelected = h === currentHourForPicker;
            return (
              <InsetRow
                key={h}
                label={fmtHour(h)}
                onClick={() => setHour(h)}
                trailing={isSelected ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : <span className="w-4 h-4" />}
              />
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}
