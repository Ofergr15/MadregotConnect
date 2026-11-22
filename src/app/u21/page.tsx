'use client';

import { useEffect, useMemo, useState } from 'react';
import { HONEYPOT_FIELD } from '@/lib/academy/intake';
import {
  DATE_HINT, DRAFT_NOTE, U21_FIELDS, U21_TRACKS, ageOn, fieldVisible, validateU21Intake,
  type U21Answers, type U21Field, type U21Track,
} from '@/lib/u21/intake';
import { parseU21TrackParam } from '@/lib/u21/entry';
import { cn } from '@/lib/utils';

type Step = 'track' | 'form' | 'review' | 'done';

const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-gray-900 focus:outline-none';

export default function U21Page() {
  // Deep link from the registration page's U21 section (/u21?track=<id>,
  // lib/u21/entry): a valid track skips the picker and opens the questionnaire
  // directly — "בחירת מסלול וכניסה קדימה". Read in the state initializer (not
  // an effect) so the track step never flashes first; null on the server.
  // The ?track= param is read once mounted, never during the first render: the
  // server has no `window` and always rendered the picker, so a first client render
  // that already showed the questionnaire failed hydration. Until mounted, nothing
  // step-specific is drawn (`ready`), so the picker never flashes before a deep
  // link either. Reading after mount also covers client-side <Link> navigation,
  // where the URL commits only after the transition (/register → track link).
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>('track');
  const [track, setTrack] = useState<U21Track | null>(null);
  useEffect(() => {
    const t = parseU21TrackParam(new URLSearchParams(window.location.search).get('track'));
    if (t) { setTrack(t); setStep('form'); }
    setReady(true);
  }, []);
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

  const set = (key: string, value: U21Answers[string]) => {
    setAnswers(a => ({ ...a, [key]: value }));
    // The field just edited drops its own stale error (re-checked on the next submit);
    // otherwise "שדה חובה" stayed under an answered question until then.
    setErrors(e => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  // The questionnaire's button validates and opens the read-only review; nothing is
  // sent until the review's own send button (the native plan's U21Review step).
  function toReview() {
    setServerError(null);
    const v = validateU21Intake(track, answers);
    setErrors(v.errors);
    // Focus (not only scroll to) the summary, so a keyboard or screen-reader user
    // lands on the list of fields to fix instead of staying on the submit button.
    if (!v.ok) { setTimeout(() => document.getElementById(SUMMARY_ID)?.focus(), 0); return; }
    setStep('review');
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    setServerError(null);
    const v = validateU21Intake(track, answers);
    setErrors(v.errors);
    if (!v.ok) { setStep('form'); setTimeout(() => document.getElementById(SUMMARY_ID)?.focus(), 0); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/u21/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track, answers, [HONEYPOT_FIELD]: honeypot }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Field errors from the server belong next to their fields: back to the form.
        if (json.errors) { setErrors(json.errors); setStep('form'); }
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

  if (!ready) return null;

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

  if (step === 'review') {
    return (
      <div>
        <button type="button" className="mb-4 text-sm text-gray-600 underline" onClick={() => setStep('form')}>
          ← עריכה
        </button>
        <h1 className="mb-1 text-2xl font-bold" tabIndex={-1}>בדיקת הפרטים לפני שליחה</h1>
        <p className="mb-6 text-sm text-gray-600">מסלול נבחר: <b>{chosen?.name}</b></p>
        <div className="space-y-4" data-testid="u21-review">
          {sections.map(s => {
            const visible = s.fields.filter(f => fieldVisible(f.key, answers, age));
            if (!visible.length) return null;
            return (
              <section key={s.title} className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-lg font-semibold">{s.title}</h2>
                <dl className="space-y-2 text-sm">
                  {visible.map(f => (
                    <div key={f.key}>
                      <dt className="text-gray-600">{f.label}</dt>
                      <dd className="font-medium"><bdi dir={f.type === 'email' || f.type === 'tel' ? 'ltr' : undefined}>{reviewValue(f, answers[f.key])}</bdi></dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
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

  return (
    <div>
      <button type="button" className="mb-4 text-sm text-gray-600 underline" onClick={() => setStep('track')}>
        ← חזרה לבחירת מסלול
      </button>
      <h1 className="mb-1 text-2xl font-bold">שאלון היכרות</h1>
      <p className="mb-6 text-sm text-gray-600">מסלול נבחר: <b>{chosen?.name}</b></p>
      {errCount > 0 && (
        <div id={SUMMARY_ID} data-testid="u21-error-summary" role="alert" tabIndex={-1}
          className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 focus:outline focus:outline-2 focus:outline-red-700">
          <p>יש {errCount} שדות שצריך לתקן</p>
          <ul className="mt-1 list-inside list-disc">
            {U21_FIELDS.filter(f => errors[f.key]).map(f => (
              <li key={f.key}><a className="underline" href={`#${fieldId(f.key)}`}>{f.label}</a></li>
            ))}
          </ul>
        </div>
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
        type="button" onClick={toReview}
        className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-lg font-semibold text-white disabled:opacity-50"
      >
        המשך לבדיקה
      </button>
    </div>
  );
}

/** How an answer reads on the review: the option text as chosen, never a code. */
function reviewValue(f: U21Field, v: U21Answers[string]): string {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return '—';
  if (f.type === 'yesno') return v === 'yes' ? 'כן' : v === 'no' ? 'לא' : '—';
  if (f.type === 'checkbox') return v === true ? 'אושר' : '—';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

const SUMMARY_ID = 'u21-error-summary';
const fieldId = (key: string) => `u21-f-${key}`;

function FieldInput({ f, value, error, onChange }: {
  f: U21Field; value: U21Answers[string]; error?: string; onChange: (v: U21Answers[string]) => void;
}) {
  const id = fieldId(f.key);
  const labelId = `${id}-label`;
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [f.type === 'date' ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  const aria = { 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy } as const;
  const star = f.required && <span className="text-red-600"> *</span>;
  const errorText = error && <span id={errId} className="mt-1 block text-sm text-red-700">{error}</span>;

  // Choice questions are a group of buttons, NOT a <label>: a label forwards a tap on
  // the question text to its first button, which silently answered it (on the safety
  // questions, that first button is "כן").
  const choice = (buttons: React.ReactNode) => (
    <div id={id} role="group" aria-labelledby={labelId} tabIndex={-1} {...aria}>
      <span id={labelId} className="mb-1 block text-sm font-medium">{f.label}{star}</span>
      {buttons}
      {errorText}
    </div>
  );
  const pill = (on: boolean, extra = 'px-3') =>
    cn('rounded-full border py-1.5 text-sm', extra, on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white');

  switch (f.type) {
    case 'radio':
      return choice(
        <div className="flex flex-wrap gap-2">
          {f.options.map(o => (
            <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={pill(value === o)}>{o}</button>
          ))}
        </div>,
      );
    case 'checkboxes': {
      const arr = Array.isArray(value) ? value : [];
      return choice(
        <div className="flex flex-wrap gap-2">
          {f.options.map(o => {
            const on = arr.includes(o);
            return (
              <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? arr.filter(x => x !== o) : [...arr, o])} className={pill(on)}>{o}</button>
            );
          })}
        </div>,
      );
    }
    case 'yesno':
      return choice(
        <div className="flex gap-2">
          {[['yes', 'כן'], ['no', 'לא']].map(([v, t]) => (
            <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={pill(value === v, 'px-4')}>{t}</button>
          ))}
        </div>,
      );
    case 'checkbox':
      return (
        <div>
          <label className="flex items-start gap-2 text-sm">
            <input id={id} type="checkbox" className="mt-1" checked={value === true} onChange={e => onChange(e.target.checked)} {...aria} />
            <span>{f.label}{star}</span>
          </label>
          {errorText}
        </div>
      );
  }

  const control = f.type === 'textarea'
    ? <textarea id={id} className={input} rows={3} value={(value as string) ?? ''} placeholder={f.placeholder} onChange={e => onChange(e.target.value)} {...aria} />
    : (
      <input
        id={id}
        className={input}
        type={f.type === 'number' ? 'text' : f.type}
        inputMode={f.type === 'number' ? 'decimal' : f.type === 'tel' ? 'tel' : undefined}
        dir={f.type === 'email' || f.type === 'tel' ? 'ltr' : undefined}
        value={(value as string) ?? ''} placeholder={f.placeholder}
        onChange={e => onChange(e.target.value)}
        {...aria}
      />
    );
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{f.label}{star}</label>
      {control}
      {f.type === 'date' && <span id={hintId} className="mt-1 block text-xs text-gray-500">{DATE_HINT}</span>}
      {errorText}
    </div>
  );
}
