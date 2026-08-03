'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle, Loader2, Users } from 'lucide-react';
import { cn, getPlanWeekStart } from '@/lib/utils';

const GROUP_PRESETS = ['דבוקה 1', 'דבוקה 2', 'דבוקה 3'];

// Pre-workout RSVP for TODAY's workout (PRD §14). Shows only when there is a
// workout scheduled today. Athlete answers: coming? + which דבוקה.
export function AttendanceRSVP({ workoutLabel }: { workoutLabel?: string }) {
  const t = useTranslations('attendance');
  const [athleteId, setAthleteId] = useState('');
  const weekStart = getPlanWeekStart(new Date());
  const day = new Date().getDay();

  const [attending, setAttending] = useState<boolean | null>(null);
  const [group, setGroup] = useState('');
  const [customGroup, setCustomGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const id = localStorage.getItem('athlete_id') || '';
    setAthleteId(id);
    if (!id) { setLoaded(true); return; }
    fetch(`/api/attendance?weekStart=${weekStart}&day=${day}&athleteId=${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.rsvp) {
          setAttending(data.rsvp.attending);
          const g = data.rsvp.groupLabel || '';
          if (g && !GROUP_PRESETS.includes(g)) setCustomGroup(g);
          else setGroup(g);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [weekStart, day]);

  const submit = async (isAttending: boolean) => {
    if (!athleteId) return;
    setAttending(isAttending);
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athleteId, weekStart, day,
          attending: isAttending,
          groupLabel: isAttending ? (customGroup.trim() || group || null) : null,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  if (!loaded || !athleteId) return null;

  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-4 w-4 text-[#4338ff]" />
        <h3 className="text-sm font-bold text-white" dir="rtl">{t('title')}</h3>
        {saved && <CheckCircle2 className="h-4 w-4 text-green-400 ms-auto" />}
        {saving && <Loader2 className="h-4 w-4 text-slate-400 animate-spin ms-auto" />}
      </div>
      {workoutLabel && <p className="text-xs text-slate-400 mb-3" dir="rtl">{workoutLabel}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => submit(true)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition',
            attending === true ? 'bg-[#4338ff] text-white' : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700')}
          dir="rtl"
        >
          <CheckCircle2 className="h-4 w-4" /> {t('coming')}
        </button>
        <button
          onClick={() => submit(false)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition',
            attending === false ? 'bg-slate-600 text-white' : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700')}
          dir="rtl"
        >
          <XCircle className="h-4 w-4" /> {t('notComing')}
        </button>
      </div>

      {attending === true && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-slate-400 mb-2" dir="rtl">{t('whichGroup')}</p>
          <div className="flex flex-wrap gap-2">
            {GROUP_PRESETS.map(g => (
              <button
                key={g}
                onClick={() => { setGroup(g); setCustomGroup(''); submitGroup(g, ''); }}
                className={cn('px-3 py-2 rounded-full text-xs font-bold transition',
                  group === g && !customGroup ? 'bg-[#4338ff] text-white' : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700')}
                dir="rtl"
              >
                {g}
              </button>
            ))}
          </div>
          <input
            dir="rtl"
            value={customGroup}
            onChange={e => { setCustomGroup(e.target.value); setGroup(''); }}
            onBlur={() => customGroup.trim() && submitGroup('', customGroup)}
            placeholder={t('otherGroup')}
            className="w-full mt-2 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#4338ff]"
          />
        </div>
      )}
    </div>
  );

  // Persist a group choice without flipping attendance (already true).
  async function submitGroup(preset: string, custom: string) {
    if (!athleteId) return;
    setSaving(true);
    try {
      await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athleteId, weekStart, day, attending: true,
          groupLabel: custom.trim() || preset || null,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }
}
