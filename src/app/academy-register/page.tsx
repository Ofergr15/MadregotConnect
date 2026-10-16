'use client';

import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { CARD, SHADOW } from '@/components/trainee/ui';
import { cn } from '@/lib/utils';
import { CLOTHING_SIZES } from '@/lib/kit-sizes';
import { EU_SHOE_SIZES } from '@/lib/shoe-catalog';
import { formNameProblem, normalizeDisplayName } from '@/lib/names/latin';
import { HONEYPOT_FIELD, looksLikeToken, numberOnly, splitName } from '@/lib/academy/intake';

// Mirrors the current Google Form "שאלון אישי להצטרפות אל Madregot Academy".
// Structured name/email/phone are lifted into columns; everything else is stored
// as the academy_intake JSON blob. (Blood-test file upload is intentionally left
// out of v1 — needs file storage; the coach can request it separately.)
type Field =
  // `inputMode` is what picks the phone keyboard. A number field is rendered as a
  // text input with inputMode + pattern: that is what gets iOS to open the big
  // keypad the phone field gets, where type="number" gives a row of small keys.
  | { key: string; label: string; type: 'text' | 'email' | 'tel' | 'number' | 'date'; required?: boolean; placeholder?: string; inputMode?: 'numeric' | 'decimal' }
  | { key: string; label: string; type: 'textarea'; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'radio' | 'select'; required?: boolean; options: string[] }
  // Same data as a radio, laid out as a wrapping row of pills. Added for the kit
  // sizes: four size questions as stacked radios is twenty-four rows of nearly
  // identical text, which buries the medical and goal questions above them. Short
  // mutually-exclusive options only — a sentence does not fit in a pill.
  | { key: string; label: string; type: 'chips'; required?: boolean; options: string[] }
  | { key: string; label: string; type: 'checkboxes'; required?: boolean; options: string[] };

const HEALTHY = 'בריא לחלוטין';

/** A follow-up that only shows (and is only checked) while its question has the
 *  answer that calls for it. `on` is the question it depends on. */
const SHOWN_WHEN: Record<string, { on: string; when: (answer: any) => boolean }> = {
  hearAboutOther: { on: 'hearAbout', when: a => a === 'אחר' },
  // Details only once an answer other than "healthy" is picked.
  medicalDetails: { on: 'medicalHistory', when: a => !!a && a !== HEALTHY },
};

const FIELDS: Field[] = [
  // Hebrew or English, whichever the applicant writes (lib/names/latin.ts
  // formNameProblem). The roster's Latin name arrives with Strava at /join.
  { key: 'firstName', label: 'שם פרטי', type: 'text', required: true, placeholder: 'דניאל' },
  { key: 'lastName', label: 'שם משפחה', type: 'text', required: true, placeholder: 'לוי' },
  { key: 'email', label: 'אימייל', type: 'email', required: true },
  { key: 'phone', label: 'מספר נייד', type: 'tel', required: true, placeholder: '050-0000000' },
  { key: 'focus', label: 'מה מדבר אליך יותר', type: 'radio', required: true, options: [
    'שילוב של תכנית און ליין עם מפגשים פיזיים',
    'רק תכנית אימון און ליין ומעקב',
  ] },
  // A birth date rather than an age: an age is stale a year after the form.
  { key: 'birthDate', label: 'תאריך לידה', type: 'date', required: true },
  { key: 'weight', label: 'משקל (בק״ג)', type: 'number', inputMode: 'decimal' },
  { key: 'height', label: 'גובה (בס״מ)', type: 'number', required: true, inputMode: 'numeric' },
  { key: 'city', label: 'מקום מגורים', type: 'text', required: true },
  { key: 'group', label: 'לאיזה דבוקה תרצה להשתייך', type: 'radio', required: true, options: [
    'דבוקה 4 מרתון חזק עם רצון לסאב 3',
    'דבוקה 5 אימון למרתון באזור ה-3:30',
    'דבוקה 6 ביצוע מרתון מלא בכל תוצאה',
    'דבוקה 7 הכנה לחצי מרתון',
    'דבוקה 8 שיפור הישגים למרחקים קצרים 5 ק"מ 10 ק"מ',
    'דבוקה 9 אימון למתחילים מ-0',
  ] },
  // Asked in its own words, and first on the running page: it took the place of the
  // goal question (four fixed goals), which said less than a sentence does.
  { key: 'runningHistory', label: 'מה היה הרקע שלך בריצה בשנה האחרונה?', type: 'textarea', required: true },
  { key: 'achievements', label: 'במידה ויש הישגים בתחום הריצה אנא פרט/י', type: 'textarea' },
  // One answer, not several (2.41.63): "healthy" next to "chronic problem" said nothing.
  { key: 'medicalHistory', label: 'עבר רפואי', type: 'radio', required: true, options: [
    HEALTHY,
    'יש בעיה רפואית כרונית',
    'נוטל תרופות באופן קבוע',
    'היו בעיות עבר שאינן כרגע',
  ] },
  { key: 'medicalDetails', label: 'אנא פרט/י', type: 'textarea' },
  { key: 'hearAbout', label: 'איך שמעת על קבוצת הריצה', type: 'radio', options: ['אינסטגרם', 'פייסבוק', 'חברים', 'אחר'] },
  { key: 'hearAboutOther', label: 'ספרו לנו איך', type: 'text', required: true },
  // ── Kit sizes, together and last ────────────────────────────────────────────
  // Shirt size was the only one collected, so ordering anything else meant asking
  // twenty people one at a time in WhatsApp. Grouped and rendered as pills so the
  // four of them cost about as much of the form as the one did.
  { key: 'shirtSize', label: 'מה מידת החולצה שלך', type: 'chips', required: true, options: [...CLOTHING_SIZES] },
  { key: 'pantsSize', label: 'מה מידת המכנסיים שלך', type: 'chips', required: true, options: [...CLOTHING_SIZES] },
  { key: 'tightsSize', label: 'מה מידת הטייץ שלך', type: 'chips', required: true, options: [...CLOTHING_SIZES] },
  // Shoe size rather than socks: socks follow from it, and it is the number people
  // know. Twenty-nine half sizes are too many pills, so it is the native picker.
  { key: 'shoeSize', label: 'מה מידת הנעליים שלך', type: 'select', required: true, options: EU_SHOE_SIZES },
];


// Twenty-three questions on one phone screen is a scroll nobody finishes from an
// Instagram link. Four short pages, each checked before the next, same questions.
const STEPS: { title: string; keys: string[] }[] = [
  { title: 'הפרטים שלך', keys: ['firstName', 'lastName', 'email', 'phone'] },
  { title: 'קצת עליך', keys: ['focus', 'birthDate', 'weight', 'height', 'city'] },
  { title: 'הריצה שלך', keys: ['runningHistory', 'group', 'achievements', 'hearAbout', 'hearAboutOther'] },
  { title: 'בריאות ומידות', keys: ['medicalHistory', 'medicalDetails', 'shirtSize', 'pantsSize', 'tightsSize', 'shoeSize'] },
];
const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]));

// ── Birth date as three pickers ──────────────────────────────────────────────
// Not <input type="date">: on iOS it draws its own box that ignores the width and
// sticks out of the card in RTL, and an empty one shows TODAY in English, which
// reads as already answered. Three native selects open the iOS wheel each, sit in
// the card, and say nothing until picked. The value is "YYYY-MM-DD" with empty
// parts until all three are chosen ("-03-" is month only).
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function isWholeDate(v: unknown): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function DateParts({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [y = '', m = '', d = ''] = value.split('-');
  const put = (ny: string, nm: string, nd: string) => onChange(ny || nm || nd ? `${ny}-${nm}-${nd}` : '');
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 10 - 1930 + 1 }, (_, i) => String(thisYear - 10 - i));
  // The T5 choice tile (grey until picked), so the three wheels read as one answer
  // inside the field's card rather than three boxes of their own.
  const cls = 'w-full min-w-0 min-h-[44px] appearance-none rounded-[12px] bg-[#F2F2F6] px-2 text-center text-base font-bold text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-600';
  return (
    <div id={id} role="group" aria-labelledby={`${id}-q`} className="mt-1.5 grid grid-cols-[1fr_1.6fr_1.3fr] gap-2">
      <select aria-label="יום" value={d} onChange={e => put(y, m, e.target.value)} className={cls}>
        <option value="">יום</option>
        {Array.from({ length: 31 }, (_, i) => pad2(i + 1)).map(v => <option key={v} value={v}>{Number(v)}</option>)}
      </select>
      <select aria-label="חודש" value={m} onChange={e => put(y, e.target.value, d)} className={cls}>
        <option value="">חודש</option>
        {MONTHS_HE.map((name, i) => <option key={name} value={pad2(i + 1)}>{name}</option>)}
      </select>
      <select aria-label="שנה" value={y} onChange={e => put(e.target.value, m, d)} className={cls}>
        <option value="">שנה</option>
        {years.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
}

// ── T5 (mockup academy-launch-fixes.html) ────────────────────────────────────
// A typed answer is a white "field" card with its question as the small grey line
// above the value; a choice is a card with the question as its title and the
// answers as tiles. Grey until picked, then the brand's light fill with an outline.
const FIELD_CARD = cn('block rounded-[14px] bg-white px-3.5 pb-2 pt-[7px] focus-within:ring-2 focus-within:ring-brand-600', SHADOW);
const CHOICE_CARD = cn(CARD, 'px-4 py-3.5');
const FIELD_LABEL = 'block text-[11.5px] font-extrabold text-ink-400';
// text-base and up: under 16px iOS Safari zooms the page on every focus, and this
// form is opened from Instagram on a phone.
const FIELD_INPUT = 'mt-px w-full min-h-[26px] bg-transparent p-0 text-base font-bold text-ink-900 placeholder:font-medium placeholder:text-ink-300 focus:outline-none';
const tile = (on: boolean) => cn(
  'min-h-[44px] rounded-[12px] text-[14px] font-extrabold transition-colors',
  on ? 'bg-[#EEF0FF] text-brand-600 outline outline-2 outline-brand-600' : 'bg-[#F2F2F6] text-ink-500',
);
/** Short answers sit side by side as tiles; a sentence gets a full-width row. */
const isShortChoice = (options: string[]) => options.every(o => o.length <= 12);

function Required() {
  return <span className="text-accent-red"> *</span>;
}

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
  // The manager's open/closed switch (lib/academy/registration.ts), answered for
  // this visitor: a personal invitation (?i=) gets through a closed door. Null
  // until known, so a closed academy never flashes the form first.
  const [canRegister, setCanRegister] = useState<boolean | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const i = q.get('i');
    setSrc(q.get('src'));
    fetch(`/api/academy/registration${looksLikeToken(i) ? `?invite=${i}` : ''}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(({ canRegister: may }) => setCanRegister(may !== false))
      .catch(() => setCanRegister(true));
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

  const set = (k: string, v: any) => setValues(prev => {
    const next = { ...prev, [k]: v };
    // Moving off "אחר" drops what was typed under it, so a stale answer is not sent.
    for (const [child, rule] of Object.entries(SHOWN_WHEN)) {
      if (rule.on === k && !rule.when(v)) delete next[child];
    }
    return next;
  });
  const isShown = (key: string) => {
    const rule = SHOWN_WHEN[key];
    return !rule || rule.when(values[rule.on]);
  };
  const toggle = (k: string, opt: string) => {
    const cur: string[] = values[k] || [];
    set(k, cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt]);
  };

  /** The first problem on one page, or null. */
  const problemOn = (index: number): string | null => {
    for (const key of STEPS[index].keys) {
      const f = FIELD_BY_KEY.get(key);
      if (!f?.required || !isShown(key)) continue;
      const v = values[f.key];
      const empty = f.type === 'checkboxes' ? !(v && v.length) : !(v && String(v).trim());
      if (empty) return `אנא מלא/י: ${f.label}`;
      if (f.type === 'date' && !isWholeDate(v)) return `אנא בחר/י יום, חודש ושנה: ${f.label}`;
    }
    // Same rule the server enforces, said on the FIRST page so it is a correction
    // and not a rejection: nobody should fill in twenty fields and then be told no.
    if (STEPS[index].keys.includes('firstName')) {
      for (const key of ['firstName', 'lastName'] as const) {
        if (formNameProblem(values[key]) === 'no-letters') return 'אנא כתבו את השם באותיות';
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


  if (canRegister === null) return <div className="min-h-screen bg-[#F4F4F8]" dir="rtl" />;

  if (!canRegister) {
    return (
      <div className="min-h-screen bg-[#F4F4F8] flex items-center justify-center p-4" dir="rtl">
        <div className={cn(CARD, 'w-full max-w-md p-6 sm:p-8 text-center')}>
          <GraduationCap className="h-12 w-12 text-brand-600 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-ink-700">ההרשמה סגורה כרגע</h2>
          <p className="text-ink-400 text-sm mt-2 leading-relaxed">
            ההרשמה לאקדמיית הריצה של מדרגות סגורה כעת. עקבו אחרינו לפתיחת המחזור הבא.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[#F4F4F8] flex items-start justify-center p-4 pt-[18vh]" dir="rtl">
        <div className={cn(CARD, 'w-full max-w-md p-6 sm:p-8 text-center')}>
          {/* The club's own logo, not a generic check: this is the first thing of
              ours a stranger sees after sending, and often the only one for days. */}
          <img src="/images/logo.png" alt="Madregot" width={112} height={112} className="mx-auto mb-4 h-28 w-28 object-contain" />
          <h2 className="text-lg font-bold text-ink-700">תודה שפנית לאקדמיית הריצה של מדרגות</h2>
          <p className="text-ink-400 text-sm mt-2 leading-relaxed">
            הטופס התקבל. נחזור אליך בימים הקרובים לשיחת היכרות קצרה.
          </p>
        </div>
      </div>
    );
  }

  const last = step === STEPS.length - 1;

  return (
    <div className="flex min-h-screen flex-col bg-[#F4F4F8]" dir="rtl">
      {/* T5's bar: the form's name, centred, on the iOS translucent white. The step
          sits under it so "how much is left" is on screen the whole way down. */}
      <header className="safe-top sticky top-0 z-20 border-b border-[#E9E9EF] bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-lg px-4">
          <h1 className="flex h-[52px] items-center justify-center text-[17px] font-extrabold text-ink-900">הרשמה לאקדמיה</h1>
          <div className="pb-2.5" aria-live="polite">
            <div className="mb-1.5 flex items-center justify-between text-[13px] font-extrabold text-ink-700">
              <span>{STEPS[step].title}</span>
              <span className="font-bold text-ink-400"><bdi dir="ltr">{step + 1}/{STEPS.length}</bdi></span>
            </div>
            <div className="flex gap-1" aria-hidden="true">
              {STEPS.map((_, i) => (
                <div key={i} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-brand-600' : 'bg-[#E2E2E8]')} />
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* A column, so on a short page the foot still sits at the bottom of the screen. */}
      <form onSubmit={submit} className="mx-auto flex w-full max-w-lg flex-1 flex-col">
        <div className="flex-1 space-y-2.5 px-4 pb-6 pt-3.5">
          <p className="text-center text-[14px] leading-normal text-ink-500">
            {prefilled ? 'הפרטים שלך כבר מולאו. נשאר רק לספר לנו עליך.' : 'ממלאים פעם אחת, ונחזור אליך בימים הקרובים.'}
          </p>

          {/* The honeypot. Clipped to nothing rather than display:none, which some bots
              skip. NOT pushed off-screen with left:-10000px: in an RTL page the left is
              scrollable, so that made the page 10,390px wide and iOS slid the whole
              form sideways. */}
          <div aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}>
            <label htmlFor="ar-website">Website</label>
            <input id="ar-website" name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off"
              value={honeypot} onChange={e => setHoneypot(e.target.value)} />
          </div>

          {STEPS[step].keys.filter(isShown).map(k => FIELD_BY_KEY.get(k)!).map(f => {
            // A typed answer: the whole card is the <label>, so a tap anywhere on it
            // focuses the input, and a screen reader reads the question and not the
            // placeholder ("Daniel", "התשובה שלך") as the field's name.
            if (f.type === 'text' || f.type === 'email' || f.type === 'tel' || f.type === 'number') {
              const ltr = f.type === 'email' || f.type === 'tel';
              return (
                <label key={f.key} htmlFor={`ar-${f.key}`} className={FIELD_CARD}>
                  <span className={FIELD_LABEL}>{f.label}{f.required && <Required />}</span>
                  <input
                    id={`ar-${f.key}`} type={f.type === 'number' ? 'text' : f.type} value={values[f.key] || ''} placeholder={(f as any).placeholder || 'התשובה שלך'}
                    inputMode={(f as any).inputMode}
                    pattern={f.type === 'number' ? ((f as any).inputMode === 'decimal' ? '[0-9]*[.,]?[0-9]*' : '[0-9]*') : undefined}
                    autoComplete={f.type === 'number' ? 'off' : undefined}
                    // An address and a phone number are LTR runs; typed into an RTL box
                    // they jump around as they grow. Right-aligned, so they still sit
                    // under the question.
                    dir={ltr ? 'ltr' : undefined}
                    onChange={e => set(f.key, f.type === 'number' ? numberOnly(e.target.value, (f as any).inputMode === 'decimal') : e.target.value)}
                    className={cn(FIELD_INPUT, ltr && 'text-right')}
                  />
                </label>
              );
            }
            if (f.type === 'textarea') {
              return (
                <label key={f.key} htmlFor={`ar-${f.key}`} className={FIELD_CARD}>
                  <span className={FIELD_LABEL}>{f.label}{f.required && <Required />}</span>
                  <textarea
                    id={`ar-${f.key}`} value={values[f.key] || ''} rows={3} placeholder="התשובה שלך"
                    onChange={e => set(f.key, e.target.value)}
                    className={cn(FIELD_INPUT, 'resize-y py-1 leading-normal')}
                  />
                </label>
              );
            }
            if (f.type === 'date' || f.type === 'select') {
              return (
                <div key={f.key} className={FIELD_CARD}>
                  <span id={`ar-${f.key}-q`} className={FIELD_LABEL}>{f.label}{f.required && <Required />}</span>
                  {f.type === 'date' && (
                    <DateParts id={`ar-${f.key}`} value={values[f.key] || ''} onChange={v => set(f.key, v)} />
                  )}
                  {f.type === 'select' && (
                    <select
                      aria-labelledby={`ar-${f.key}-q`} value={values[f.key] || ''}
                      onChange={e => set(f.key, e.target.value)}
                      className={cn(FIELD_INPUT, 'appearance-none', !values[f.key] && 'font-medium text-ink-300')}
                    >
                      <option value="" disabled>בחירה</option>
                      {f.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  )}
                </div>
              );
            }

            // A choice: the question as the card's title, the answers as tiles.
            return (
              <div key={f.key} className={CHOICE_CARD}>
                <p id={`ar-${f.key}-q`} className="text-[15px] font-extrabold text-ink-900">
                  {f.label}{f.required && <Required />}
                </p>

                {f.type === 'radio' && (
                  <div role="radiogroup" aria-labelledby={`ar-${f.key}-q`}
                    className={cn('mt-2', isShortChoice(f.options) ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2')}>
                    {f.options.map(opt => {
                      const on = values[f.key] === opt;
                      return (
                        <button key={opt} type="button" role="radio" aria-checked={on} onClick={() => set(f.key, opt)}
                          className={cn(tile(on), !isShortChoice(f.options) && 'px-3.5 py-2.5 text-start leading-snug')}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {f.type === 'chips' && (
                  // Same data as a radio, as a wrapping row of tiles: four size
                  // questions as stacked rows is twenty-four rows of nearly identical
                  // text, which buries the medical question above them.
                  <div role="group" aria-labelledby={`ar-${f.key}-q`} className="mt-2 grid grid-cols-6 gap-1.5" dir="ltr">
                    {f.options.map(opt => {
                      const isSelected = values[f.key] === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => set(f.key, opt)}
                          aria-pressed={isSelected}
                          className={cn(tile(isSelected), 'px-0')}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {f.type === 'checkboxes' && (
                  <div role="group" aria-labelledby={`ar-${f.key}-q`} className="mt-2 flex flex-col gap-2">
                    {f.options.map(opt => {
                      const on = (values[f.key] || []).includes(opt);
                      return (
                        <button key={opt} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(f.key, opt)}
                          className={cn(tile(on), 'px-3.5 py-2.5 text-start leading-snug')}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {error && <p role="alert" className="text-center text-sm font-bold text-accent-red">{error}</p>}
        </div>

        {/* T5's foot: the one action, pinned to the bottom so it is never a scroll away. */}
        <div className="safe-bottom sticky bottom-0 z-10 border-t border-[#E2E2E7] bg-[#F4F4F8]/95 backdrop-blur">
          <div className="flex gap-2.5 px-4 pb-3 pt-2.5">
            {step > 0 && (
              <button type="button" disabled={submitting}
                onClick={() => { setError(null); setStep(s => s - 1); window.scrollTo({ top: 0 }); }}
                className={cn('h-[52px] flex-1 rounded-[15px] bg-white text-[16px] font-extrabold text-brand-600 disabled:opacity-50', SHADOW)}>
                חזרה
              </button>
            )}
            <button type="submit" disabled={submitting}
              className="flex h-[52px] flex-[2] items-center justify-center gap-1.5 rounded-[15px] bg-brand-600 text-[16px] font-extrabold text-white active:bg-brand-700 disabled:opacity-60">
              {submitting && <Spinner size={18} />}
              {!last ? 'המשך' : submitting ? 'שולח…' : 'שליחה'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
