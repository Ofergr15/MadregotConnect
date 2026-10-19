'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, GraduationCap } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { CARD, NumberRuns } from '@/components/trainee/ui';
import { cn } from '@/lib/utils';
import { CLOTHING_SIZES } from '@/lib/kit-sizes';
import { EU_SHOE_SIZES } from '@/lib/shoe-catalog';
import { formNameProblem, normalizeDisplayName } from '@/lib/names/latin';
import { HONEYPOT_FIELD, looksLikeToken, numberOnly, splitName } from '@/lib/academy/intake';
import { GROUP_DISPLAY, GROUP_TINT } from '@/lib/academy/intake-display';

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
// v3 (academy-form-v3.html): "מה מדבר אליך יותר" moved up to the first page, because
// it is the answer the manager reads first. `name` is the step's word under the bar.
const FULL_STEPS: { title: string; name: string; sub: string; keys: string[] }[] = [
  { title: 'הפרטים שלך', name: 'פרטים', sub: 'ממלאים פעם אחת, ונחזור אליך בימים הקרובים', keys: ['firstName', 'lastName', 'email', 'phone', 'focus'] },
  { title: 'קצת עליך', name: 'עליך', sub: 'כמה פרטים כדי שנכיר אותך', keys: ['birthDate', 'weight', 'height', 'city'] },
  { title: 'הריצה שלך', name: 'הריצה', sub: 'כדי שנשבץ אותך בדבוקה הנכונה', keys: ['runningHistory', 'group', 'achievements', 'hearAbout', 'hearAboutOther'] },
  { title: 'בריאות ומידות', name: 'בריאות ומידות', sub: 'אחרון, ואנחנו בקשר', keys: ['medicalHistory', 'medicalDetails', 'shirtSize', 'pantsSize', 'tightsSize', 'shoeSize'] },
];
const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]));
/**
 * Somebody who already trains with us fills one page (academy-onboarding/who-fills-what.html):
 * confirm the details, the health question, how they heard of us. The coaching type, the
 * pack and the running background are the coach's ("טופס התאמה"); birth date, height, weight
 * and sizes they fill in the app.
 */
const EXISTING_STEPS: typeof FULL_STEPS = [
  { title: 'כמה פרטים, ואתה באפליקציה', name: 'פרטים', sub: 'עמוד אחד · חצי דקה',
    keys: ['firstName', 'lastName', 'email', 'phone', 'medicalHistory', 'medicalDetails', 'hearAbout', 'hearAboutOther'] },
];

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
  // v3's white bordered field, one per wheel, so the three read as one answer.
  const cls = 'w-full min-w-0 min-h-[48px] appearance-none rounded-[14px] border border-[#E6E6EC] bg-white px-2 text-center text-base font-semibold text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-[3px] focus:ring-[#EEF0FF]';
  return (
    <div id={id} role="group" aria-labelledby={`${id}-q`} className="grid grid-cols-[1fr_1.6fr_1.3fr] gap-2">
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

// ── v3 (mockup academy-form-v3.html, "הטופס של המתאמן") ──────────────────────
// White bordered fields on a light page; the focused one blue with a soft ring. A
// typed answer carries its question as the small grey line inside the box; a choice
// gets its question above it, after a thin blue bar, and its answers as rows that
// turn blue when picked.
const FIELD_BOX = 'block rounded-[14px] border border-[#E6E6EC] bg-white px-3.5 pb-2 pt-[9px] transition-shadow focus-within:border-brand-600 focus-within:ring-[3px] focus-within:ring-[#EEF0FF]';
/** The field the shown error is about, so the eye lands on it. */
const FIELD_BAD = 'border-accent-red';
const FIELD_LABEL = 'block text-[12.5px] font-bold text-ink-400';
// text-base and up: under 16px iOS Safari zooms the page on every focus, and this
// form is opened from Instagram on a phone.
const FIELD_INPUT = 'mt-[3px] w-full min-h-[24px] bg-transparent p-0 text-[16.5px] font-semibold text-ink-900 placeholder:font-medium placeholder:text-[#BFC0C9] focus:outline-none';
/** The question over a choice, with v3's thin blue bar before it. */
const QUESTION = "mx-0.5 mb-2 text-[14.5px] font-extrabold text-[#33343F] before:me-[7px] before:inline-block before:h-[13px] before:w-1 before:rounded-sm before:bg-brand-600 before:align-[-1px] before:content-['']";
const row = (on: boolean) => cn(
  'flex w-full min-h-[48px] items-center gap-3 rounded-[14px] border px-3.5 py-3 text-start text-[15px] font-semibold leading-snug text-ink-900 transition-colors',
  on ? 'border-brand-600 bg-[#EEF0FF]' : 'border-[#E6E6EC] bg-white',
);
/** Short answers sit two to a line; a sentence gets a full-width row. */
const isShortChoice = (options: string[]) => options.every(o => o.length <= 12);

function Required() {
  return <span className="text-accent-red"> *</span>;
}

/** The radio's ring: grey, then a thick blue ring when picked. */
function Ring({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={cn('h-5 w-5 shrink-0 rounded-full', on ? 'border-[6px] border-brand-600' : 'border-2 border-[#BFC0C9]')} />;
}

/** One pack: its tinted number, a short name, and the line saying who it is for. */
function GroupRow({ option, on, onPick }: { option: string; on: boolean; onPick: () => void }) {
  const d = GROUP_DISPLAY[option];
  const [bg, fg, line] = (d && GROUP_TINT[d.n]) || ['#F6F6F9', '#4A4B57', '#E6E6EC'];
  return (
    // The accessible name is the stored answer itself, so what a screen reader says
    // and what the manager later reads are the same words.
    <button type="button" role="radio" aria-checked={on} aria-label={option} onClick={onPick} className={row(on)}>
      <span aria-hidden="true" className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border text-[14px] font-black"
        style={{ background: bg, color: fg, borderColor: line }}>
        {d ? <bdi dir="ltr">{d.n}</bdi> : '·'}
      </span>
      <span aria-hidden="true" className="min-w-0">
        <NumberRuns text={d ? d.name : option} />
        {d?.sub && <span className="mt-px block text-[12.5px] font-medium text-ink-400"><NumberRuns text={d.sub} /></span>}
      </span>
    </button>
  );
}

export default function AcademyRegisterPage() {
  const [values, setValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // What the server said, when it said no. A field problem is NOT kept here: see `tried`.
  const [error, setError] = useState<string | null>(null);
  // The page whose המשך was pressed with something missing. Its problem is worked out
  // again on every render rather than frozen as a string, so it goes away the moment
  // the field is filled — the old page said "אנא מלא/י: שם פרטי" under a filled name.
  const [tried, setTried] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  // Door A's personal link (?i=) and door B's source (?src=ig). Read from the URL
  // on mount rather than useSearchParams, which would need a Suspense boundary for
  // a page that is otherwise fully static.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  // Somebody who already trains with us (their card is 'existing'): a details update for the
  // app, not an application — the pack and "how did you hear of us" are not asked.
  const [existing, setExisting] = useState(false);
  const STEPS = existing ? EXISTING_STEPS : FULL_STEPS;
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
        if (prefill.existing) setExisting(true);
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

  /** The first problem on one page, and the field it is about, or null. */
  const problemOn = (index: number): { key: string; message: string } | null => {
    for (const key of STEPS[index].keys) {
      const f = FIELD_BY_KEY.get(key);
      if (!f?.required || !isShown(key)) continue;
      const v = values[f.key];
      const empty = f.type === 'checkboxes' ? !(v && v.length) : !(v && String(v).trim());
      if (empty) return { key, message: `אנא מלא/י: ${f.label}` };
      if (f.type === 'date' && !isWholeDate(v)) return { key, message: `אנא בחר/י יום, חודש ושנה: ${f.label}` };
    }
    // Same rule the server enforces, said on the FIRST page so it is a correction
    // and not a rejection: nobody should fill in twenty fields and then be told no.
    if (STEPS[index].keys.includes('firstName')) {
      for (const key of ['firstName', 'lastName'] as const) {
        if (formNameProblem(values[key]) === 'no-letters') return { key, message: 'אנא כתבו את השם באותיות' };
      }
    }
    return null;
  };

  const next = () => {
    setError(null);
    if (problemOn(step)) { setTried(step); return; }
    setTried(null);
    setStep(s => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enter on an early page moves on rather than submitting half a form.
    if (step < STEPS.length - 1) { next(); return; }
    for (let i = 0; i < STEPS.length; i++) {
      if (problemOn(i)) { setStep(i); setTried(i); return; }
    }
    setTried(null);
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


  if (canRegister === null) return <div className="min-h-screen bg-[#F6F6F9]" dir="rtl" />;

  if (!canRegister) {
    return (
      <div className="min-h-screen bg-[#F6F6F9] flex items-center justify-center p-4" dir="rtl">
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
      <div className="min-h-screen bg-[#F6F6F9] flex items-start justify-center p-4 pt-[18vh]" dir="rtl">
        <div className={cn(CARD, 'w-full max-w-md p-6 sm:p-8 text-center')}>
          {/* The club's own logo, not a generic check: this is the first thing of
              ours a stranger sees after sending, and often the only one for days. */}
          <img src="/images/logo.png" alt="Madregot" width={112} height={112} className="mx-auto mb-4 h-28 w-28 object-contain" />
          <h2 className="text-lg font-bold text-ink-700">{existing ? 'תודה! קיבלנו את הפרטים' : 'תודה שפנית לאקדמיית הריצה של מדרגות'}</h2>
          <p className="text-ink-400 text-sm mt-2 leading-relaxed">
            {existing
              ? 'אחרי שנעבור עליהם, יגיע אליך מייל עם הקישור להתקנת האפליקציה — בדרך כלל עוד היום.'
              : 'הטופס התקבל. נחזור אליך בימים הקרובים לשיחת היכרות קצרה.'}
          </p>
        </div>
      </div>
    );
  }

  const last = step === STEPS.length - 1;
  // Live: recomputed from the values on every render, so it clears as the field is fixed.
  const problem = tried === step ? problemOn(step) : null;
  const shownKeys = STEPS[step].keys.filter(isShown);

  /** A typed answer: the whole box is the <label>, so a tap anywhere on it focuses the
   *  input, and a screen reader reads the question and not the placeholder. */
  const typed = (f: Field) => {
    const ltr = f.type === 'email' || f.type === 'tel';
    return (
      <label key={f.key} htmlFor={`ar-${f.key}`} className={cn(FIELD_BOX, problem?.key === f.key && FIELD_BAD)}>
        <span className={FIELD_LABEL}>{f.label}{f.required && <Required />}</span>
        <input
          id={`ar-${f.key}`} type={f.type === 'number' ? 'text' : f.type} value={values[f.key] || ''} placeholder={(f as any).placeholder || 'התשובה שלך'}
          inputMode={(f as any).inputMode}
          pattern={f.type === 'number' ? ((f as any).inputMode === 'decimal' ? '[0-9]*[.,]?[0-9]*' : '[0-9]*') : undefined}
          autoComplete={f.type === 'number' ? 'off' : undefined}
          aria-invalid={problem?.key === f.key || undefined}
          // An address and a phone number are LTR runs; typed into an RTL box
          // they jump around as they grow. Right-aligned, so they still sit
          // under the question.
          dir={ltr ? 'ltr' : undefined}
          onChange={e => set(f.key, f.type === 'number' ? numberOnly(e.target.value, (f as any).inputMode === 'decimal') : e.target.value)}
          className={cn(FIELD_INPUT, ltr && 'text-right')}
        />
      </label>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#F6F6F9]" dir="rtl">
      {/* v3's header: the academy's name and the step on the right, the club's logo on
          the left, on a soft blue that fades to white. Then the step's title, a thin bar
          in four parts, and the four step names: done ones green with a tick. */}
      <header className="safe-top sticky top-0 z-20 border-b border-[#E6E6EC] bg-[linear-gradient(180deg,#F1F3FF_0%,#FFFFFF_100%)]">
        <div className="mx-auto max-w-lg px-[18px] pb-3.5 pt-2" aria-live="polite">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[15px] font-black text-ink-900" dir="ltr">Madregot Academy</p>
              {STEPS.length > 1 && (
                <p className="mt-px text-[12.5px] font-bold text-ink-400">
                  שלב <bdi dir="ltr">{step + 1}</bdi> מתוך <bdi dir="ltr">{STEPS.length}</bdi>
                </p>
              )}
            </div>
            <img src="/images/logo.png" alt="Madregot" width={40} height={40} className="h-10 w-auto object-contain" />
          </div>
          <h1 className="mt-3 text-[22px] font-black leading-tight text-ink-900">{STEPS[step].title}</h1>
          <p className="mt-0.5 text-[13.5px] text-ink-400">
            {existing ? STEPS[step].sub
              : prefilled && step === 0 ? 'הפרטים שלך כבר מולאו. נשאר רק לספר לנו עליך.' : STEPS[step].sub}
          </p>
          {existing && step === 0 && (
            <p className="mt-2.5 rounded-xl border border-[#D9DDFF] bg-[#EEF0FF] px-3 py-2 text-[12.5px] font-bold leading-snug text-[#1A22A8]">
              ✓ אתה כבר מתאמן אצלנו — זה לא טופס הצטרפות, רק עדכון פרטים לקראת האפליקציה.
            </p>
          )}
          {STEPS.length > 1 && <>
          <div className="mt-3 flex gap-[5px]" aria-hidden="true">
            {STEPS.map((_, i) => (
              <div key={i} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-brand-600' : 'bg-[#E6E6EC]')} />
            ))}
          </div>
          <ol className="mt-1.5 flex justify-between text-[11.5px] font-bold">
            {STEPS.map((s, i) => (
              <li key={s.name} aria-current={i === step ? 'step' : undefined}
                className={i < step ? 'text-[#0E7A3C]' : i === step ? 'text-brand-600' : 'text-ink-400'}>
                {i < step && '✓ '}{s.name}
              </li>
            ))}
          </ol>
          </>}
        </div>
      </header>

      {/* A column, so on a short page the foot still sits at the bottom of the screen. */}
      <form onSubmit={submit} className="mx-auto flex w-full max-w-lg flex-1 flex-col">
        <div className="flex-1 space-y-3 px-[18px] pb-6 pt-4">
          {/* The honeypot. Clipped to nothing rather than display:none, which some bots
              skip. NOT pushed off-screen with left:-10000px: in an RTL page the left is
              scrollable, so that made the page 10,390px wide and iOS slid the whole
              form sideways. */}
          <div aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}>
            <label htmlFor="ar-website">Website</label>
            <input id="ar-website" name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off"
              value={honeypot} onChange={e => setHoneypot(e.target.value)} />
          </div>

          {shownKeys.map(k => FIELD_BY_KEY.get(k)!).map(f => {
            // First and last name share one line (v3).
            if (f.key === 'lastName' && shownKeys.includes('firstName')) return null;
            if (f.key === 'firstName' && shownKeys.includes('lastName')) {
              return (
                <div key="names" className="grid grid-cols-2 gap-2.5">
                  {typed(f)}
                  {typed(FIELD_BY_KEY.get('lastName')!)}
                </div>
              );
            }
            if (f.type === 'text' || f.type === 'email' || f.type === 'tel' || f.type === 'number') return typed(f);

            if (f.type === 'textarea') {
              return (
                <div key={f.key}>
                  <label htmlFor={`ar-${f.key}`} className={cn(QUESTION, 'block')}>{f.label}{f.required && <Required />}</label>
                  <div className={cn(FIELD_BOX, 'pt-2', problem?.key === f.key && FIELD_BAD)}>
                    <textarea
                      id={`ar-${f.key}`} value={values[f.key] || ''} rows={3} placeholder="התשובה שלך"
                      aria-invalid={problem?.key === f.key || undefined}
                      onChange={e => set(f.key, e.target.value)}
                      className={cn(FIELD_INPUT, 'mt-0 resize-y py-0.5 leading-normal')}
                    />
                  </div>
                </div>
              );
            }

            if (f.type === 'date') {
              return (
                <div key={f.key}>
                  <p id={`ar-${f.key}-q`} className={QUESTION}>{f.label}{f.required && <Required />}</p>
                  <DateParts id={`ar-${f.key}`} value={values[f.key] || ''} onChange={v => set(f.key, v)} />
                </div>
              );
            }

            if (f.type === 'select') {
              // v3's picker row: the question small, the answer large, a chevron. The
              // native select covers the whole row, so a tap anywhere opens the wheel.
              return (
                <div key={f.key} className={cn(FIELD_BOX, 'relative flex items-center justify-between', problem?.key === f.key && FIELD_BAD)}>
                  <div className="min-w-0">
                    <span id={`ar-${f.key}-q`} className={FIELD_LABEL}>{f.label}{f.required && <Required />}</span>
                    <span className={cn('mt-[3px] block min-h-[24px] text-[16.5px]', values[f.key] ? 'font-bold text-ink-900' : 'font-medium text-[#BFC0C9]')}>
                      {values[f.key] ? <bdi dir="ltr">{values[f.key]}</bdi> : 'בחירה'}
                    </span>
                  </div>
                  <ChevronLeft aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-400" />
                  <select
                    aria-labelledby={`ar-${f.key}-q`} value={values[f.key] || ''}
                    onChange={e => set(f.key, e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
                  >
                    <option value="" disabled>בחירה</option>
                    {f.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
              );
            }

            // A choice: the question above, after the blue bar; the answers as rows.
            return (
              <div key={f.key}>
                <p id={`ar-${f.key}-q`} className={QUESTION}>{f.label}{f.required && <Required />}</p>

                {f.type === 'radio' && (
                  <div role="radiogroup" aria-labelledby={`ar-${f.key}-q`}
                    className={cn(isShortChoice(f.options) ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2')}>
                    {f.options.map(opt => {
                      const on = values[f.key] === opt;
                      if (f.key === 'group') return <GroupRow key={opt} option={opt} on={on} onPick={() => set(f.key, opt)} />;
                      return (
                        <button key={opt} type="button" role="radio" aria-checked={on} onClick={() => set(f.key, opt)} className={row(on)}>
                          <Ring on={on} />
                          <span className="min-w-0">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {f.type === 'chips' && (
                  // v3's one segmented row, XS to XXL. Same data as a radio: four size
                  // questions as stacked rows is twenty-four rows of nearly identical
                  // text, which buries the medical question above them.
                  // In the page's own direction, as v3 draws it: XS at the right.
                  <div role="group" aria-labelledby={`ar-${f.key}-q`}
                    className="grid grid-cols-6 overflow-hidden rounded-[13px] border border-[#E6E6EC] bg-white">
                    {f.options.map((opt, i) => {
                      const isSelected = values[f.key] === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => set(f.key, opt)}
                          aria-pressed={isSelected}
                          className={cn(
                            'h-11 text-[14.5px] font-bold transition-colors',
                            i > 0 && 'border-s border-[#E6E6EC]',
                            isSelected ? 'bg-brand-600 text-white' : 'text-[#4A4B57]',
                          )}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {f.type === 'checkboxes' && (
                  <div role="group" aria-labelledby={`ar-${f.key}-q`} className="flex flex-col gap-2">
                    {f.options.map(opt => {
                      const on = (values[f.key] || []).includes(opt);
                      return (
                        <button key={opt} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(f.key, opt)} className={row(on)}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {(problem || error) && (
            <p role="alert" className="text-center text-sm font-bold text-accent-red">{problem?.message ?? error}</p>
          )}
        </div>

        {/* v3's foot, pinned to the bottom so the action is never a scroll away. */}
        <div className="safe-bottom sticky bottom-0 z-10 border-t border-[#E6E6EC] bg-[#F6F6F9]">
          <div className="flex gap-2.5 px-[18px] pb-3 pt-3">
            {step > 0 && (
              <button type="button" disabled={submitting}
                onClick={() => { setError(null); setTried(null); setStep(s => s - 1); window.scrollTo({ top: 0 }); }}
                className="h-[54px] w-24 shrink-0 rounded-[15px] border border-[#E6E6EC] bg-white text-[16.5px] font-extrabold text-[#4A4B57] disabled:opacity-50">
                חזרה
              </button>
            )}
            <button type="submit" disabled={submitting}
              className="flex h-[54px] flex-1 items-center justify-center gap-1.5 rounded-[15px] bg-brand-600 text-[16.5px] font-extrabold text-white active:bg-brand-700 disabled:opacity-60">
              {submitting && <Spinner size={18} />}
              {!last ? 'המשך' : submitting ? 'שולח…' : 'לשלוח'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
