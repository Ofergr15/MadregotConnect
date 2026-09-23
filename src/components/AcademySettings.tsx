'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Save, CheckCircle2 } from 'lucide-react';
import { AcademySettings as Settings, DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';
import { Card, Button, Spinner, LoadingBlock, Switch } from '@/components/ui';
import { bearerHeaders } from '@/lib/auth/bearer-headers';

const DAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];

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
        method: 'PUT', headers: await bearerHeaders(),
        body: JSON.stringify({ settings: s }),
      });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    } finally { setSaving(false); }
  };

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      {/* Tests */}
      <Section title="מבחני מדידה" desc="מבחני בנצ'מרק שאפשר למדוד ספורטאים לפיהם.">
        <div className="flex flex-wrap gap-2 mb-3">
          {s.tests.map(t => (
            <span key={t} className="flex items-center gap-1.5 bg-page/60 rounded-lg ps-3 pe-2 py-1.5 text-sm text-ink-700">
              {t}
              {/* A bare 14px icon is a 12×12 tap target. The halo takes it to 44
                  without moving the chip: these sit in a wrapping row, so growing
                  the box itself would re-flow the whole list. */}
              <button onClick={() => setS({ ...s, tests: s.tests.filter(x => x !== t) })}
                aria-label={`הסרת ${t}`}
                className="relative text-ink-400 hover:text-accent-red active:text-accent-red after:absolute after:-inset-[15px] after:content-['']"
                disabled={s.tests.length <= 1}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newTest} onChange={e => setNewTest(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newTest.trim()) { setS({ ...s, tests: [...new Set([...s.tests, newTest.trim()])] }); setNewTest(''); } }}
            aria-label="שם מבחן חדש"
            placeholder="לדוגמה: 5k" className="flex-1 bg-page border border-page rounded-lg px-3 h-11 text-base text-ink-700" />
          <button onClick={() => { if (newTest.trim()) { setS({ ...s, tests: [...new Set([...s.tests, newTest.trim()])] }); setNewTest(''); } }}
            className="flex items-center gap-1 px-3 min-h-[44px] rounded-lg bg-page hover:bg-ink-300/40 text-sm text-ink-700"><Plus className="h-4 w-4" /> הוספה</button>
        </div>
      </Section>

      {/* Pace alerts */}
      <Section title="התראות קצב על השעון" desc="הדחיפה לאקדמיה כוללת יעד אזור קצב בגרמין שמצפצף כשיוצאים מהקצב.">
        <div className="flex items-center gap-3">
          <Switch checked={s.paceAlerts} onChange={(v) => setS({ ...s, paceAlerts: v })} size="sm"
            ariaLabel="התראות קצב על השעון" />
          <span className="text-sm text-ink-500">{s.paceAlerts ? 'פעיל — התראה כשיוצאים מהקצב' : 'כבוי — הקצב מוצג למידע בלבד'}</span>
        </div>
      </Section>

      {/* Tolerances */}
      <Section title="סטייה מותרת מהתוכנית" desc="כמה סטייה מהתוכנית עדיין נחשבת בטווח היעד.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TolField label="קצב ± (שניות לק״מ)" value={s.tolerances.paceSec}
            onChange={v => setS({ ...s, tolerances: { ...s.tolerances, paceSec: v } })} step={1} />
          {/* The HR tolerance was gradeable from the day HR grading shipped, and only
              the code could set it — so every heart-rate session in the club was
              judged against a default nobody had agreed to. It belongs next to the
              pace tolerance because it is the same decision on the other metric. */}
          <TolField label="דופק ± (פעימות)" value={s.tolerances.hrBpm}
            onChange={v => setS({ ...s, tolerances: { ...s.tolerances, hrBpm: v } })} step={1} />
          <TolField label="מרחק ± (%)" value={Math.round(s.tolerances.distance * 100)}
            onChange={v => setS({ ...s, tolerances: { ...s.tolerances, distance: v / 100 } })} step={1} />
          <TolField label="זמן ± (%)" value={Math.round(s.tolerances.duration * 100)}
            onChange={v => setS({ ...s, tolerances: { ...s.tolerances, duration: v / 100 } })} step={1} />
        </div>
        <p className="text-xs text-ink-400 mt-2">
          לדוגמה: יעד של 5:00 לק״מ עם ±{s.tolerances.paceSec} שנ&apos; נחשב בטווח בין {fmtPace(300 - s.tolerances.paceSec)} ל-{fmtPace(300 + s.tolerances.paceSec)}.
          {' '}אימון שנכתב בדופק 150 עם ±{s.tolerances.hrBpm} נחשב בטווח בין {150 - s.tolerances.hrBpm} ל-{150 + s.tolerances.hrBpm}.
        </p>
      </Section>

      {/* Weekly report */}
      <Section title="דוח שבועי" desc="למי נשלח דוח ההיענות ובאיזה יום.">
        <label className="block text-xs text-ink-400 mb-1.5" htmlFor="report-day">נשלח ביום</label>
        {/* Safari zooms for a <select> under 16px exactly as it does for an input. */}
        <select id="report-day" value={s.report.day} onChange={e => setS({ ...s, report: { ...s.report, day: Number(e.target.value) } })}
          className="bg-page border border-page rounded-lg px-3 h-11 text-base text-ink-700 mb-3">
          {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
        </select>
        <div className="flex flex-wrap gap-2 mb-2">
          {s.report.recipients.map(r => (
            <span key={r} className="flex items-center gap-1.5 bg-page/60 rounded-lg ps-3 pe-2 py-1.5 text-sm text-ink-700" dir="ltr">
              {r}
              <button onClick={() => setS({ ...s, report: { ...s.report, recipients: s.report.recipients.filter(x => x !== r) } })}
              aria-label={`הסרת ${r}`}
              className="relative text-ink-400 hover:text-accent-red active:text-accent-red after:absolute after:-inset-[15px] after:content-['']"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          {s.report.recipients.length === 0 && <span className="text-xs text-ink-400">כברירת מחדל נשלח למייל מנהל המועדון.</span>}
        </div>
        <div className="flex gap-2">
          <input value={newRecipient} onChange={e => setNewRecipient(e.target.value)} type="email" dir="ltr"
            aria-label="מייל נוסף לדוח השבועי"
            placeholder="coach@example.com" className="flex-1 bg-page border border-page rounded-lg px-3 h-11 text-base text-ink-700" />
          <button onClick={() => { const v = newRecipient.trim(); if (v) { setS({ ...s, report: { ...s.report, recipients: [...new Set([...s.report.recipients, v])] } }); setNewRecipient(''); } }}
            className="flex items-center gap-1 px-3 min-h-[44px] rounded-lg bg-page hover:bg-ink-300/40 text-sm text-ink-700"><Plus className="h-4 w-4" /> הוספה</button>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? <Spinner size={16} /> : <Save className="h-4 w-4" />} שמירת הגדרות
        </Button>
        {saved && <span className="flex items-center gap-1.5 text-sm text-accent-900"><CheckCircle2 className="h-4 w-4" /> נשמר</span>}
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <Card variant="solid">
      <h3 className="text-sm font-bold text-ink-700">{title}</h3>
      <p className="text-xs text-ink-400 mb-4">{desc}</p>
      {children}
    </Card>
  );
}

function TolField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step: number }) {
  return (
    // The input lives INSIDE the label, which is what ties the two together: as
    // siblings the caption was on screen but the field had no accessible name, so
    // voice control and a screen reader both got "number field" four times over.
    <label className="block">
      <span className="block text-xs text-ink-400 mb-1.5">{label}</span>
      {/* text-base and not text-sm: at 14px iOS Safari zooms the page the moment the
          field takes focus, and this is a screen of nothing but number fields. */}
      <input type="number" min={0} step={step} value={value}
        onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full bg-page border border-page rounded-lg px-3 h-11 text-base text-ink-700 tabular-nums" />
    </label>
  );
}

function fmtPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
