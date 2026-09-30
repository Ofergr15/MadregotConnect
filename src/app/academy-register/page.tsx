'use client';

import { useEffect, useState } from 'react';
import { GraduationCap, CheckCircle2 } from 'lucide-react';
import { Card, Button, LoadingBlock } from '@/components/ui';
import { CLOTHING_SIZES, SOCK_SIZES } from '@/lib/kit-sizes';
import { nameProblem, normalizeDisplayName } from '@/lib/names/latin';
import { HONEYPOT_FIELD, looksLikeToken, splitName } from '@/lib/academy/intake';

// Mirrors the current Google Form "שאלון אישי להצטרפות אל Madregot Academy".
// Structured name/email/phone are lifted into columns; everything else is stored
// as the academy_intake JSON blob. (Blood-test file upload is intentionally left
// out of v1 — needs file storage; the coach can request it separately.)
type Field =
  | { key: string; label: string; type: 'text' | 'email' | 'tel' | 'number'; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'textarea'; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'radio' | 'select'; required?: boolean; options: string[] }
  // Same data as a radio, laid out as a wrapping row of pills. Added for the kit
  // sizes: four size questions as stacked radios is twenty-four rows of nearly
  // identical text, which buries the medical and goal questions above them. Short
  // mutually-exclusive options only — a sentence does not fit in a pill.
  | { key: string; label: string; type: 'chips'; required?: boolean; options: string[] }
  | { key: string; label: string; type: 'checkboxes'; required?: boolean; options: string[] };

const FIELDS: Field[] = [
  // In English, and asked for that way. The roster is Latin-only: `athletes.name`
  // is the key that matches a Strava profile to a roster row, and a mixed-script
  // roster sorts into two blocks and shows one person under two spellings. The
  // Latin placeholders carry the expectation even before the label is read.
  { key: 'firstName', label: 'שם פרטי (באנגלית)', type: 'text', required: true, placeholder: 'Daniel' },
  { key: 'lastName', label: 'שם משפחה (באנגלית)', type: 'text', required: true, placeholder: 'Levi' },
  { key: 'email', label: 'אימייל', type: 'email', required: true },
  { key: 'phone', label: 'מספר נייד', type: 'tel', required: true, placeholder: '050-0000000' },
  { key: 'focus', label: 'מה מדבר אליך יותר', type: 'radio', required: true, options: [
    'שילוב של תכנית און ליין עם מפגשים פיזיים',
    'רק תכנית אימון און ליין ומעקב',
  ] },
  { key: 'age', label: 'גיל', type: 'number', required: true },
  { key: 'weight', label: 'משקל', type: 'number' },
  { key: 'height', label: 'גובה', type: 'number', required: true },
  { key: 'city', label: 'מקום מגורים', type: 'text', required: true },
  { key: 'maritalStatus', label: 'סטטוס משפחתי', type: 'text' },
  { key: 'goal', label: 'מה מטרתך מההשתתפות בקבוצת הריצה', type: 'radio', required: true, options: [
    'מסגרת לאימונים שתוציא אותי לרוץ',
    'מסגרת שתביא אותי להישגים חדשים',
    'שבירת שיאים',
    'מסגרת חברתית',
  ] },
  { key: 'group', label: 'לאיזה דבוקה תרצה להשתייך', type: 'radio', required: true, options: [
    'דבוקה 4 מרתון חזק עם רצון לסאב 3',
    'דבוקה 5 אימון למרתון באזור ה-3:30',
    'דבוקה 6 ביצוע מרתון מלא בכל תוצאה',
    'דבוקה 7 הכנה לחצי מרתון',
    'דבוקה 8 שיפור הישגים למרחקים קצרים 5 ק"מ 10 ק"מ',
    'דבוקה 9 אימון למתחילים מ-0',
  ] },
  { key: 'runningHistory', label: 'עבר הריצה שלך בשנה האחרונה', type: 'textarea', required: true },
  { key: 'achievements', label: 'במידה ויש הישגים בתחום הריצה אנא פרט/י', type: 'textarea' },
  { key: 'strava', label: 'במידה ויש לך חשבון סטראבה אנא כתוב את השם', type: 'text' },
  { key: 'medicalHistory', label: 'עבר רפואי', type: 'checkboxes', required: true, options: [
    'בריא לחלוטין',
    'יש בעיה רפואית כרונית',
    'נוטל תרופות באופן קבוע',
    'היו בעיות עבר שאינן כרגע',
  ] },
  { key: 'medicalDetails', label: 'במידה ולא ענית בריא לחלוטין בשאלה הקודמת אנא פרט', type: 'textarea' },
  { key: 'hearAbout', label: 'איך שמעת על קבוצת הריצה', type: 'text' },
  { key: 'instagram', label: 'תוכל לשתף את עמוד האינסטגרם שלך במידה ויש', type: 'text', required: true },
  // ── Kit sizes, together and last ────────────────────────────────────────────
  // Shirt size was the only one collected, so ordering anything else meant asking
  // twenty people one at a time in WhatsApp. Grouped and rendered as pills so the
  // four of them cost about as much of the form as the one did.
  { key: 'shirtSize', label: 'מה מידת החולצה שלך', type: 'chips', required: true, options: [...CLOTHING_SIZES] },
  { key: 'pantsSize', label: 'מה מידת המכנסיים שלך', type: 'chips', required: true, options: [...CLOTHING_SIZES] },
  { key: 'tightsSize', label: 'מה מידת הטייץ שלך', type: 'chips', required: true, options: [...CLOTHING_SIZES] },
  { key: 'socksSize', label: 'מה מידת הגרביים שלך', type: 'chips', required: true, options: [...SOCK_SIZES] },
];

// The public form works via direct link; the landing-page "Join the Academy"
// buttons are intentionally disabled ("Coming Soon"), so the form isn't
// advertised there. Flip to false to fully close registration.
const REGISTRATION_OPEN = true;

// Twenty-three questions on one phone screen is a scroll nobody finishes from an
// Instagram link. Four short pages, each checked before the next, same questions.
const STEPS: { title: string; keys: string[] }[] = [
  { title: 'הפרטים שלך', keys: ['firstName', 'lastName', 'email', 'phone'] },
  { title: 'קצת עליך', keys: ['focus', 'age', 'weight', 'height', 'city', 'maritalStatus'] },
  { title: 'הריצה שלך', keys: ['goal', 'group', 'runningHistory', 'achievements', 'strava', 'hearAbout', 'instagram'] },
  { title: 'בריאות ומידות', keys: ['medicalHistory', 'medicalDetails', 'shirtSize', 'pantsSize', 'tightsSize', 'socksSize'] },
];
const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]));

const isTyped = (f: Field) =>
  f.type === 'text' || f.type === 'email' || f.type === 'tel' || f.type === 'number' || f.type === 'textarea';

export default function AcademyRegisterPage() {
  const [values, setValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  // Door A's personal link (?i=) and door B's source (?src=ig). Read from the URL
  // on mount rather than useSearchParams, which would need a Suspense boundary for
  // a page that is otherwise fully static.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const i = q.get('i');
    setSrc(q.get('src'));
    if (!looksLikeToken(i)) return;
    setInviteToken(i);
    fetch(`/api/academy/register?i=${i}`)
      .then(r => r.json())
      .then(({ prefill }) => {
        if (!prefill) return;
        const { firstName, lastName } = splitName(prefill.name);
        // Only into empty fields: a slow response must not overwrite what was typed.
        setValues(prev => ({
          ...prev,
          firstName: prev.firstName || firstName,
          lastName: prev.lastName || lastName,
          email: prev.email || prefill.email,
          phone: prev.phone || prefill.phone,
        }));
        setPrefilled(true);
      })
      .catch(() => {});
  }, []);

  const set = (k: string, v: any) => setValues(prev => ({ ...prev, [k]: v }));
  const toggle = (k: string, opt: string) => {
    const cur: string[] = values[k] || [];
    set(k, cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt]);
  };

  /** The first problem on one page, or null. */
  const problemOn = (index: number): string | null => {
    for (const key of STEPS[index].keys) {
      const f = FIELD_BY_KEY.get(key);
      if (!f?.required) continue;
      const v = values[f.key];
      const empty = f.type === 'checkboxes' ? !(v && v.length) : !(v && String(v).trim());
      if (empty) return `אנא מלא/י: ${f.label}`;
    }
    // Same rule the server enforces, said on the FIRST page so it is a correction
    // and not a rejection: nobody should fill in twenty fields and then be told no.
    if (STEPS[index].keys.includes('firstName')) {
      for (const key of ['firstName', 'lastName'] as const) {
        if (nameProblem(values[key]) === 'not-latin') return 'אנא כתבו את השם באותיות אנגליות';
      }
    }
    return null;
  };

  const next = () => {
    const problem = problemOn(step);
    if (problem) { setError(problem); return; }
    setError(null);
    setStep(s => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enter on an early page moves on rather than submitting half a form.
    if (step < STEPS.length - 1) { next(); return; }
    for (let i = 0; i < STEPS.length; i++) {
      const problem = problemOn(i);
      if (problem) { setStep(i); setError(problem); return; }
    }
    setSubmitting(true);
    setError(null);
    try {
      const { firstName, lastName, email, phone, ...rest } = values;
      // The DB `name` column (used across roster/leaderboard/emails) expects a full
      // name; keep first/last separately in the intake too.
      const name = normalizeDisplayName(`${firstName || ''} ${lastName || ''}`);
      const intake = { firstName: normalizeDisplayName(firstName), lastName: normalizeDisplayName(lastName), ...rest };
      const res = await fetch('/api/academy/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, intake, inviteToken, src, [HONEYPOT_FIELD]: honeypot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'ההרשמה נכשלה');
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'ההרשמה נכשלה');
    } finally {
      setSubmitting(false);
    }
  };

  if (!REGISTRATION_OPEN) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-4" dir="rtl">
        <Card className="w-full max-w-md p-6 sm:p-8 text-center">
          <GraduationCap className="h-12 w-12 text-brand-600 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-ink-700">ההרשמה סגורה כרגע</h2>
          <p className="text-ink-400 text-sm mt-2 leading-relaxed">
            ההרשמה לאקדמיית הריצה של מדרגות סגורה כעת. עקבו אחרינו לפתיחת המחזור הבא.
          </p>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-4" dir="rtl">
        <Card className="w-full max-w-md p-6 sm:p-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-accent-600 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-ink-700">הטופס התקבל!</h2>
          <p className="text-ink-400 text-sm mt-2 leading-relaxed">
            תודה שפנית לאקדמיית הריצה של מדרגות. שלחנו לך מייל אישור, ובימים הקרובים
            נחזור אליך לשיחת היכרות קצרה. אין צורך לעשות שום דבר נוסף בינתיים.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page py-8 px-4" dir="rtl">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="bg-brand-600/20 w-14 h-14 rounded-2xl flex items-center justify-center ring-1 ring-brand-600/20 mx-auto mb-3">
            <GraduationCap className="h-7 w-7 text-brand-600" />
          </div>
          <h1 className="text-xl font-bold text-ink-700">שאלון הצטרפות · Madregot Academy</h1>
          <p className="text-ink-400 mt-2 text-sm">
            {prefilled ? 'הפרטים שלך כבר מולאו — נשאר רק לספר לנו עליך' : 'מלא/י את הפרטים כדי שנבנה לך פרופיל מתאמן'}
          </p>
        </div>

        <div className="mb-4" aria-live="polite">
          <div className="flex items-center justify-between text-sm font-bold text-ink-700 mb-2">
            <span>{STEPS[step].title}</span>
            <span className="text-ink-400 font-medium"><bdi dir="ltr">{step + 1}/{STEPS.length}</bdi></span>
          </div>
          <div className="flex gap-1.5" aria-hidden="true">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-600' : 'bg-ink-300'}`} />
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {/* The honeypot. Off-screen rather than display:none, which some bots skip. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
            <label htmlFor="ar-website">Website</label>
            <input id="ar-website" name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off"
              value={honeypot} onChange={e => setHoneypot(e.target.value)} />
          </div>

          {STEPS[step].keys.map(k => FIELD_BY_KEY.get(k)!).map(f => (
            <Card key={f.key} variant="plain">
              {/* A real <label for> on the typed fields and a group heading on the
                  choice fields — the audit found every input named only by its
                  placeholder ("Daniel", "התשובה שלך"), which a screen reader reads
                  as the answer and not the question. */}
              {isTyped(f) ? (
                <label htmlFor={`ar-${f.key}`} className="block text-sm font-medium text-ink-700 mb-2">
                  {f.label} {f.required && <span className="text-accent-red">*</span>}
                </label>
              ) : (
                <p id={`ar-${f.key}-q`} className="block text-sm font-medium text-ink-700 mb-2">
                  {f.label} {f.required && <span className="text-accent-red">*</span>}
                </p>
              )}

              {(f.type === 'text' || f.type === 'email' || f.type === 'tel' || f.type === 'number') && (
                <input
                  id={`ar-${f.key}`} type={f.type} value={values[f.key] || ''} placeholder={(f as any).placeholder || 'התשובה שלך'}
                  onChange={e => set(f.key, e.target.value)}
                  // text-base, not text-sm: under 16px iOS Safari zooms the page on
                  // every focus, and this form is opened from Instagram on a phone.
                  className="w-full bg-page border border-ink-300 rounded-lg px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              )}

              {f.type === 'textarea' && (
                <textarea
                  id={`ar-${f.key}`} value={values[f.key] || ''} rows={3} placeholder="התשובה שלך"
                  onChange={e => set(f.key, e.target.value)}
                  className="w-full bg-page border border-ink-300 rounded-lg px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600 resize-y"
                />
              )}

              {f.type === 'radio' && (
                // Rows at 44, not the 32 that `p-1.5` around a 20px line gave. The
                // gap goes to zero because the rows' own height now spaces them.
                <div role="radiogroup" aria-labelledby={`ar-${f.key}-q`}>
                  {f.options.map(opt => (
                    <label key={opt} className="flex min-h-[44px] items-center gap-2.5 cursor-pointer px-1.5 rounded-lg hover:bg-page/40">
                      <input type="radio" name={f.key} checked={values[f.key] === opt} onChange={() => set(f.key, opt)}
                        className="accent-brand-600 w-4 h-4" />
                      <span className="text-sm text-ink-500">{opt}</span>
                    </label>
                  ))}
                </div>
              )}

              {f.type === 'chips' && (
                <div role="group" aria-labelledby={`ar-${f.key}-q`} className="flex flex-wrap gap-1.5">
                  {f.options.map(opt => {
                    const isSelected = values[f.key] === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => set(f.key, opt)}
                        aria-pressed={isSelected}
                        className={
                          'min-w-[52px] h-11 px-3 rounded-pill text-sm font-semibold border transition-colors ' +
                          (isSelected
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-card text-ink-500 border-page hover:bg-page/40')
                        }
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {f.type === 'checkboxes' && (
                <div role="group" aria-labelledby={`ar-${f.key}-q`}>
                  {f.options.map(opt => (
                    <label key={opt} className="flex min-h-[44px] items-center gap-2.5 cursor-pointer px-1.5 rounded-lg hover:bg-page/40">
                      <input type="checkbox" checked={(values[f.key] || []).includes(opt)} onChange={() => toggle(f.key, opt)}
                        className="accent-brand-600 w-4 h-4" />
                      <span className="text-sm text-ink-500">{opt}</span>
                    </label>
                  ))}
                </div>
              )}
            </Card>
          ))}

          {error && <p className="text-sm text-accent-red text-center">{error}</p>}

          <div className="flex gap-2">
            {step > 0 && (
              <Button type="button" variant="ghost" size="lg" disabled={submitting} className="flex-1"
                onClick={() => { setError(null); setStep(s => s - 1); window.scrollTo({ top: 0 }); }}>
                חזרה
              </Button>
            )}
            <Button type="submit" size="lg" disabled={submitting} className="flex-[2]">
              {submitting && <LoadingBlock size={20} className="py-0" />}
              {step < STEPS.length - 1 ? 'המשך' : submitting ? 'שולח…' : 'שליחה'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
