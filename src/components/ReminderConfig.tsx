'use client';

import { useState, useEffect } from 'react';
import { Bell, Loader2, Check, ChevronDown, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Sheet } from '@/components/ui';

interface Cfg {
  teamDays: number[];
  dayBefore: { enabled: boolean; hour: number };
  eveningBefore: { enabled: boolean; hour: number };
  workoutHour?: number; // team workout start (IL); drives the RSVP cutoff
}
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']; // Sun..Sat (Hebrew initials)

// One canonical toggle-switch look (48×28), duplicated locally here and in
// MaintenanceToggle/NotificationPrefs — there's no shared `Switch` primitive
// in the design system yet, so each of those three Settings components carried
// its own slightly-different hand-rolled track/thumb. Keeping this local copy
// (rather than adding one to ui/index.tsx) still fixes the visual mismatch
// between the three since they now all render this exact size/style.
function Switch({ on, onToggle, disabled, label }: { on: boolean; onToggle: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      className={cn('relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50', on ? 'bg-primary-600' : 'bg-slate-600')}>
      <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white transition-all', on ? 'start-6' : 'start-1')} />
    </button>
  );
}

type PickerTarget = 'dayBefore' | 'eveningBefore' | 'workoutHour' | null;

export function ReminderConfig() {
  const t = useTranslations('settings');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const [actorEmail, setActorEmail] = useState('');
  const [pickerFor, setPickerFor] = useState<PickerTarget>(null);

  useEffect(() => {
    setActorEmail(localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '');
    fetch('/api/reminder-config').then(r => r.ok ? r.json() : null).then(d => setCfg(d?.config || null)).catch(() => {});
  }, []);

  const save = async (next: Cfg) => {
    setCfg(next);
    setSaving(true);
    try {
      const res = await fetch('/api/reminder-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: next, actorEmail }),
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
            <Switch on={enabled} onToggle={() => save({ ...cfg, [stage]: { ...cfg[stage], enabled: !enabled } })} label={label} />
            <button
              onClick={() => setPickerFor(stage)}
              disabled={!enabled}
              className="min-h-[44px] min-w-[44px] flex items-center gap-1 px-1.5 text-sm text-slate-300 disabled:opacity-40 tabular-nums"
            >
              {fmtHour(cfg[stage].hour)}
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
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
          {saving && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
          {flash && <Check className="w-3.5 h-3.5 text-green-400" />}
        </div>
      )}

      <InsetSection header={t('workoutReminders')}>
        <InsetRow
          icon={Bell}
          iconBg="bg-primary-600"
          label={t('teamWorkoutTime')}
          value={fmtHour(cfg.workoutHour ?? 18)}
          onClick={() => setPickerFor('workoutHour')}
        />
        <StageRow label={t('reminderDayBefore')} stage="dayBefore" />
        <StageRow label={t('reminderEveningBefore')} stage="eveningBefore" />
      </InsetSection>

      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-4">
        <p className="text-xs font-semibold text-slate-400 mb-2">{t('teamWorkoutDays')}</p>
        <div className="flex gap-1.5 flex-wrap">
          {DAYS.map((d, i) => (
            <button key={i} onClick={() => toggleDay(i)}
              className={cn('min-w-[44px] min-h-[44px] rounded-lg text-xs font-bold transition',
                cfg.teamDays.includes(i) ? 'bg-primary-600 text-white' : 'bg-slate-700/40 text-slate-400 hover:bg-slate-700')}>
              {d}
            </button>
          ))}
        </div>
        <p className="text-2xs text-slate-500 mt-3">{t('reminderFooterNote')}</p>
      </div>

      {/* Hour picker — a bottom sheet list, replacing the raw 24-option
          <select> (the least native-feeling way to pick a time on iOS). */}
      <Sheet open={pickerFor !== null} onOpenChange={(o) => !o && setPickerFor(null)} title={t('selectHour')}>
        <div className="rounded-2xl bg-slate-900/40 overflow-hidden divide-y divide-slate-700/50">
          {hours.map(h => {
            const isSelected = h === currentHourForPicker;
            return (
              <InsetRow
                key={h}
                label={fmtHour(h)}
                onClick={() => setHour(h)}
                trailing={isSelected ? <CheckCircle2 className="h-4 w-4 text-primary-400" /> : <span className="w-4 h-4" />}
              />
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}
