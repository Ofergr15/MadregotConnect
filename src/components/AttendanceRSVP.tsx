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
          setGroup(data.rsvp.groupLabel || '');
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
          groupLabel: isAttending ? (group || null) : null,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  if (!loaded || !athleteId) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary-500/25 p-4"
      style={{ background: 'linear-gradient(150deg, rgba(67,56,255,.22), rgba(30,41,59,.6) 72%)' }}
    >
      {/* soft brand glow — marks this as the focused "today" hero */}
      <div className="pointer-events-none absolute -top-8 start-[-20px] w-40 h-40 rounded-full blur-2xl"
        style={{ background: 'radial-gradient(circle, rgba(67,56,255,.4), transparent 70%)' }} aria-hidden="true" />
      <div className="relative flex items-center gap-2 mb-1">
        <Users className="h-4 w-4 text-primary-400" />
        <h3 className="text-sm font-bold text-white" dir="rtl">{t('title')}</h3>
        {saved && <CheckCircle2 className="h-4 w-4 text-green-400 ms-auto" />}
        {saving && <Loader2 className="h-4 w-4 text-slate-400 animate-spin ms-auto" />}
      </div>
      {workoutLabel && <p className="relative text-[15px] font-semibold text-white mb-3" dir="rtl">{workoutLabel}</p>}

      <div className="relative flex gap-2">
        <button
          onClick={() => submit(true)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition',
            attending === true ? 'bg-primary-600 text-white' : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700')}
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
        <div className="relative mt-3">
          <p className="text-xs font-semibold text-slate-400 mb-2" dir="rtl">{t('whichGroup')}</p>
          <div className="flex flex-wrap gap-2">
            {GROUP_PRESETS.map(g => (
              <button
                key={g}
                onClick={() => { setGroup(g); submitGroup(g, ''); }}
                className={cn('px-3 py-2 rounded-full text-xs font-bold transition',
                  group === g ? 'bg-primary-600 text-white' : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700')}
                dir="rtl"
              >
                {g}
              </button>
            ))}
          </div>
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
