'use client';

import { useState, useEffect } from 'react';
import { Loader2, Plus, X, Save, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AcademySettings as Settings, DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AcademySettingsPanel() {
  const [s, setS] = useState<Settings>(DEFAULT_ACADEMY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newTest, setNewTest] = useState('');
  const [newRecipient, setNewRecipient] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/academy/settings');
        const data = await res.json();
        if (data.settings) setS(data.settings);
      } catch { /* defaults */ } finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/academy/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: s }),
      });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-7 w-7 text-primary-500 animate-spin" /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Tests */}
      <Section title="Tests" desc="Benchmark tests athletes can be measured on.">
        <div className="flex flex-wrap gap-2 mb-3">
          {s.tests.map(t => (
            <span key={t} className="flex items-center gap-1.5 bg-slate-700/60 rounded-lg ps-3 pe-2 py-1.5 text-sm text-white">
              {t}
              <button onClick={() => setS({ ...s, tests: s.tests.filter(x => x !== t) })} className="text-slate-400 hover:text-red-300" disabled={s.tests.length <= 1}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newTest} onChange={e => setNewTest(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newTest.trim()) { setS({ ...s, tests: [...new Set([...s.tests, newTest.trim()])] }); setNewTest(''); } }}
            placeholder="e.g. 5k" className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 h-9 text-sm text-white" />
          <button onClick={() => { if (newTest.trim()) { setS({ ...s, tests: [...new Set([...s.tests, newTest.trim()])] }); setNewTest(''); } }}
            className="flex items-center gap-1 px-3 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-white"><Plus className="h-4 w-4" /> Add</button>
        </div>
      </Section>

      {/* Pace alerts */}
      <Section title="Pace alerts on watch" desc="Academy pushes include a Garmin pace-zone target that beeps when off-pace.">
        <label className="flex items-center gap-3 cursor-pointer">
          <button
            onClick={() => setS({ ...s, paceAlerts: !s.paceAlerts })}
            className={cn('relative w-11 h-6 rounded-full transition-colors', s.paceAlerts ? 'bg-primary-600' : 'bg-slate-600')}
          >
            <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', s.paceAlerts ? 'start-[22px]' : 'start-0.5')} />
          </button>
          <span className="text-sm text-slate-300">{s.paceAlerts ? 'On — alert when off pace' : 'Off — pace shown as info only'}</span>
        </label>
      </Section>

      {/* Tolerances */}
      <Section title="“On plan” tolerances" desc="How close to plan still counts as on target.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TolField label="Pace ± (seconds/km)" value={s.tolerances.paceSec}
            onChange={v => setS({ ...s, tolerances: { ...s.tolerances, paceSec: v } })} step={1} />
          <TolField label="Distance ± (%)" value={Math.round(s.tolerances.distance * 100)}
            onChange={v => setS({ ...s, tolerances: { ...s.tolerances, distance: v / 100 } })} step={1} />
          <TolField label="Time ± (%)" value={Math.round(s.tolerances.duration * 100)}
            onChange={v => setS({ ...s, tolerances: { ...s.tolerances, duration: v / 100 } })} step={1} />
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Example: a 5:00/km target with ±{s.tolerances.paceSec}s is good from {fmtPace(300 - s.tolerances.paceSec)} to {fmtPace(300 + s.tolerances.paceSec)}.
        </p>
      </Section>

      {/* Weekly report */}
      <Section title="Weekly report" desc="Who gets the compliance email and when.">
        <label className="block text-xs text-slate-400 mb-1.5">Send on</label>
        <select value={s.report.day} onChange={e => setS({ ...s, report: { ...s.report, day: Number(e.target.value) } })}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 h-9 text-sm text-white mb-3">
          {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
        </select>
        <div className="flex flex-wrap gap-2 mb-2">
          {s.report.recipients.map(r => (
            <span key={r} className="flex items-center gap-1.5 bg-slate-700/60 rounded-lg ps-3 pe-2 py-1.5 text-sm text-white">
              {r}
              <button onClick={() => setS({ ...s, report: { ...s.report, recipients: s.report.recipients.filter(x => x !== r) } })} className="text-slate-400 hover:text-red-300"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          {s.report.recipients.length === 0 && <span className="text-xs text-slate-500">Defaults to the club admin email.</span>}
        </div>
        <div className="flex gap-2">
          <input value={newRecipient} onChange={e => setNewRecipient(e.target.value)} type="email"
            placeholder="coach@example.com" className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 h-9 text-sm text-white" />
          <button onClick={() => { const v = newRecipient.trim(); if (v) { setS({ ...s, report: { ...s.report, recipients: [...new Set([...s.report.recipients, v])] } }); setNewRecipient(''); } }}
            className="flex items-center gap-1 px-3 h-9 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-white"><Plus className="h-4 w-4" /> Add</button>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-5 h-11 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
        </button>
        {saved && <span className="flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Saved</span>}
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <p className="text-xs text-slate-400 mb-4">{desc}</p>
      {children}
    </div>
  );
}

function TolField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step: number }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
      <input type="number" min={0} step={step} value={value}
        onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 h-9 text-sm text-white tabular-nums" />
    </div>
  );
}

function fmtPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
