'use client';

import { useMemo, useState } from 'react';
import { HONEYPOT_FIELD } from '@/lib/academy/intake';
import {
  DRAFT_NOTE, U21_FIELDS, U21_TRACKS, ageOn, fieldVisible, validateU21Intake,
  type U21Answers, type U21Field, type U21Track,
} from '@/lib/u21/intake';
import { cn } from '@/lib/utils';

type Step = 'track' | 'form' | 'done';

const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-gray-900 focus:outline-none';

export default function U21Page() {
  const [step, setStep] = useState<Step>('track');
  const [track, setTrack] = useState<U21Track | null>(null);
  const [answers, setAnswers] = useState<U21Answers>({});
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const age = typeof answers.birthDate === 'string' ? ageOn(answers.birthDate) : null;
  const sections = useMemo(() => {
    const out: Array<{ title: string; fields: U21Field[] }> = [];
    for (const f of U21_FIELDS) {
      const last = out[out.length - 1];
      if (last?.title === f.section) last.fields.push(f); else out.push({ title: f.section, fields: [f] });
    }
    return out;
  }, []);

  const set = (key: string, value: U21Answers[string]) => setAnswers(a => ({ ...a, [key]: value }));

  async function submit() {
    setServerError(null);
    const v = validateU21Intake(track, answers);
    setErrors(v.errors);
    if (!v.ok) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/u21/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track, answers, [HONEYPOT_FIELD]: honeypot }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.errors) setErrors(json.errors);
        setServerError(res.status === 429 ? 'יותר מדי ניסיונות, נסו שוב בעוד דקה' : 'לא הצלחנו לשמור את הפרטים, נסו שוב');
        return;
      }
      setStep('done');
      window.scrollTo({ top: 0 });
    } catch {
      setServerError('בעיית תקשורת, נסו שוב');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'done') {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-3 text-2xl font-bold">הפרטים נקלטו ✓</h1>
        <p className="mb-3">המאמן יעבור על הפרטים ויחזור אליך.</p>
        <p className="mt-4 text-sm text-gray-500">סטטוס: ממתין לבדיקת מאמן</p>
      </div>
    );
  }

  if (step === 'track') {
    return (
      <div>
        <h1 className="mb-2 text-3xl font-bold">מדרגות · מאמן אישי U21</h1>
        <p className="mb-6 text-gray-600">
          תוכנית שבועית לריצה, כוח ומוביליטי לגילאי 16–21 — מכינות, שנת שירות ותיכון.
          כל תוכנית עוברת את המאמן רועי לפני שהיא נשלחת, וכל מצטרף/ת הופך/ת לחלק מקהילת מדרגות.
        </p>
        <div className="space-y-4">
          {U21_TRACKS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTrack(t.id); setStep('form'); window.scrollTo({ top: 0 }); }}
              className={cn('block w-full rounded-2xl border-2 bg-white p-5 text-right shadow-sm transition hover:border-gray-900',
                track === t.id ? 'border-gray-900' : 'border-transparent')}
            >
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-xl font-bold">{t.name}</span>
                <span className="text-lg font-semibold">₪{t.priceIls} <span className="text-sm font-normal text-gray-500">לחודש</span></span>
              </div>
              <p className="mb-3 text-sm text-gray-600">{t.tagline}</p>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {t.benefits.map(b => <li key={b}>{b}</li>)}
              </ul>
            </button>
          ))}
        </div>
        <p className="mt-6 text-xs text-gray-500">בחירת מסלול אינה כרוכה בתשלום בשלב זה.</p>
      </div>
    );
  }

  const chosen = U21_TRACKS.find(t => t.id === track);
  const errCount = Object.keys(errors).length;

  return (
    <div>
      <button type="button" className="mb-4 text-sm text-gray-600 underline" onClick={() => setStep('track')}>
        ← חזרה לבחירת מסלול
      </button>
      <h1 className="mb-1 text-2xl font-bold">שאלון היכרות</h1>
      <p className="mb-6 text-sm text-gray-600">מסלול נבחר: <b>{chosen?.name}</b> (₪{chosen?.priceIls} לחודש)</p>
      {errCount > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">יש {errCount} שדות שצריך לתקן</div>
      )}
      {/* Honeypot: hidden from people, filled by bots. */}
      <input
        type="text" name={HONEYPOT_FIELD} value={honeypot} onChange={e => setHoneypot(e.target.value)}
        tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden"
      />
      <div className="space-y-6">
        {sections.map(s => {
          const visible = s.fields.filter(f => fieldVisible(f.key, answers, age));
          if (!visible.length) return null;
          return (
            <section key={s.title} className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-lg font-semibold">{s.title}</h2>
              {(s.title === 'בריאות ובטיחות' || visible.some(f => f.type === 'checkbox')) && (
                <p className="mb-3 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{DRAFT_NOTE}</p>
              )}
              <div className="mb-3" />
              <div className="space-y-4">
                {visible.map(f => <FieldInput key={f.key} f={f} value={answers[f.key]} error={errors[f.key]} onChange={v => set(f.key, v)} />)}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-gray-500">
        השאלון אינו מהווה אבחון רפואי. במקרה של ספק בנוגע למצב בריאותי יש להתייעץ עם רופא/ה.
      </p>
      {serverError && <p className="mt-3 text-sm text-red-700">{serverError}</p>}
      <button
        type="button" onClick={submit} disabled={submitting}
        className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-lg font-semibold text-white disabled:opacity-50"
      >
        {submitting ? 'שולח…' : 'שליחה'}
      </button>
    </div>
  );
}

function FieldInput({ f, value, error, onChange }: {
  f: U21Field; value: U21Answers[string]; error?: string; onChange: (v: U21Answers[string]) => void;
}) {
  const label = <span className="mb-1 block text-sm font-medium">{f.label}{f.required && <span className="text-red-600"> *</span>}</span>;
  let control: React.ReactNode;
  switch (f.type) {
    case 'textarea':
      control = <textarea className={input} rows={3} value={(value as string) ?? ''} placeholder={f.placeholder} onChange={e => onChange(e.target.value)} />;
      break;
    case 'radio':
      control = (
        <div className="flex flex-wrap gap-2">
          {f.options.map(o => (
            <button key={o} type="button" onClick={() => onChange(o)}
              className={cn('rounded-full border px-3 py-1.5 text-sm', value === o ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white')}>{o}</button>
          ))}
        </div>
      );
      break;
    case 'checkboxes': {
      const arr = Array.isArray(value) ? value : [];
      control = (
        <div className="flex flex-wrap gap-2">
          {f.options.map(o => {
            const on = arr.includes(o);
            return (
              <button key={o} type="button" onClick={() => onChange(on ? arr.filter(x => x !== o) : [...arr, o])}
                className={cn('rounded-full border px-3 py-1.5 text-sm', on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white')}>{o}</button>
            );
          })}
        </div>
      );
      break;
    }
    case 'yesno':
      control = (
        <div className="flex gap-2">
          {[['yes', 'כן'], ['no', 'לא']].map(([v, t]) => (
            <button key={v} type="button" onClick={() => onChange(v)}
              className={cn('rounded-full border px-4 py-1.5 text-sm', value === v ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white')}>{t}</button>
          ))}
        </div>
      );
      break;
    case 'checkbox':
      return (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={value === true} onChange={e => onChange(e.target.checked)} />
          <span>{f.label}{f.required && <span className="text-red-600"> *</span>}{error && <span className="block text-red-700">{error}</span>}</span>
        </label>
      );
    default:
      control = (
        <input
          className={input}
          type={f.type === 'number' ? 'text' : f.type}
          inputMode={f.type === 'number' ? 'decimal' : f.type === 'tel' ? 'tel' : undefined}
          dir={f.type === 'email' || f.type === 'tel' ? 'ltr' : undefined}
          value={(value as string) ?? ''} placeholder={f.placeholder}
          onChange={e => onChange(e.target.value)}
        />
      );
  }
  return (
    <label className="block">
      {label}
      {control}
      {error && <span className="mt-1 block text-sm text-red-700">{error}</span>}
    </label>
  );
}
