'use client';

import { useState, useEffect } from 'react';
import { Bell, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Cfg {
  teamDays: number[];
  dayBefore: { enabled: boolean; hour: number };
  eveningBefore: { enabled: boolean; hour: number };
}
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']; // Sun..Sat (Hebrew initials)

export function ReminderConfig() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const [actorEmail, setActorEmail] = useState('');

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

  const StageRow = ({ label, stage }: { label: string; stage: 'dayBefore' | 'eveningBefore' }) => (
    <div className="flex items-center gap-3 py-2">
      <button
        onClick={() => save({ ...cfg, [stage]: { ...cfg[stage], enabled: !cfg[stage].enabled } })}
        className={cn('relative w-11 h-6 rounded-full transition-colors shrink-0', cfg[stage].enabled ? 'bg-[#4338ff]' : 'bg-slate-600')}>
        <span className={cn('absolute top-1 h-4 w-4 rounded-full bg-white transition-all', cfg[stage].enabled ? 'start-6' : 'start-1')} />
      </button>
      <span className="text-sm text-slate-200 flex-1">{label}</span>
      <select
        value={cfg[stage].hour}
        onChange={e => save({ ...cfg, [stage]: { ...cfg[stage], hour: Number(e.target.value) } })}
        disabled={!cfg[stage].enabled}
        className="bg-slate-900/50 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white disabled:opacity-50">
        {hours.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
      </select>
    </div>
  );

  return (
    <div className="mb-6 rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-[#4338ff]" />
        <h3 className="text-sm font-bold text-white">Workout reminders</h3>
        {flash && <Check className="w-3.5 h-3.5 text-green-400" />}
        {saving && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
      </div>

      <p className="text-xs font-semibold text-slate-400 mb-1.5">Team-workout days</p>
      <div className="flex gap-1.5 mb-3">
        {DAYS.map((d, i) => (
          <button key={i} onClick={() => toggleDay(i)}
            className={cn('w-8 h-8 rounded-lg text-xs font-bold transition',
              cfg.teamDays.includes(i) ? 'bg-[#4338ff] text-white' : 'bg-slate-700/40 text-slate-400 hover:bg-slate-700')}>
            {d}
          </button>
        ))}
      </div>

      <div className="border-t border-slate-700/50 pt-1">
        <StageRow label="תזכורת יום לפני (לכולם)" stage="dayBefore" />
        <StageRow label="ערב לפני — למי שלא ענה" stage="eveningBefore" />
      </div>
      <p className="text-[11px] text-slate-500 mt-2">Israel time. Post-workout survey fires automatically after each run syncs.</p>
    </div>
  );
}
