'use client';

import { useState } from 'react';
import { GraduationCap, Loader2, CheckCircle2 } from 'lucide-react';

// Mirrors the current Google Form "שאלון אישי להצטרפות אל Madregot Academy".
// Structured name/email/phone are lifted into columns; everything else is stored
// as the academy_intake JSON blob. (Blood-test file upload is intentionally left
// out of v1 — needs file storage; the coach can request it separately.)
type Field =
  | { key: string; label: string; type: 'text' | 'email' | 'tel' | 'number'; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'textarea'; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'radio' | 'select'; required?: boolean; options: string[] }
  | { key: string; label: string; type: 'checkboxes'; required?: boolean; options: string[] };

const FIELDS: Field[] = [
  { key: 'firstName', label: 'שם פרטי', type: 'text', required: true },
  { key: 'lastName', label: 'שם משפחה', type: 'text', required: true },
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
  { key: 'shirtSize', label: 'מה מידת החולצה שלך', type: 'radio', required: true, options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
];

export default function AcademyRegisterPage() {
  const [values, setValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: any) => setValues(prev => ({ ...prev, [k]: v }));
  const toggle = (k: string, opt: string) => {
    const cur: string[] = values[k] || [];
    set(k, cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Required validation.
    for (const f of FIELDS) {
      if (!f.required) continue;
      const v = values[f.key];
      const empty = f.type === 'checkboxes' ? !(v && v.length) : !(v && String(v).trim());
      if (empty) { setError(`אנא מלא/י: ${f.label}`); return; }
    }
    setSubmitting(true);
    setError(null);
    try {
      const { firstName, lastName, email, phone, ...rest } = values;
      // The DB `name` column (used across roster/leaderboard/emails) expects a full
      // name; keep first/last separately in the intake too.
      const name = `${(firstName || '').trim()} ${(lastName || '').trim()}`.trim();
      const intake = { firstName: firstName?.trim(), lastName: lastName?.trim(), ...rest };
      const res = await fetch('/api/academy/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, intake }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ההרשמה נכשלה');
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'ההרשמה נכשלה');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl p-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white">ההרשמה התקבלה!</h2>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            תודה שפנית לאקדמיית הריצה של מדרגות. המאמן יעבור על הפרטים שלך ולאחר אישור
            תקבל/י מייל עם קישור לחיבור השעון והצטרפות לפלטפורמה.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 py-8 px-4" dir="rtl">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="bg-primary-600/20 w-14 h-14 rounded-2xl flex items-center justify-center ring-1 ring-primary-500/20 mx-auto mb-3">
            <GraduationCap className="h-7 w-7 text-primary-300" />
          </div>
          <h1 className="text-xl font-bold text-white">שאלון הצטרפות · Madregot Academy</h1>
          <p className="text-slate-400 mt-2 text-sm">מלא/י את הפרטים כדי שנבנה לך פרופיל מתאמן</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {FIELDS.map(f => (
            <div key={f.key} className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
              <label className="block text-sm font-medium text-slate-200 mb-2">
                {f.label} {f.required && <span className="text-red-400">*</span>}
              </label>

              {(f.type === 'text' || f.type === 'email' || f.type === 'tel' || f.type === 'number') && (
                <input
                  type={f.type} value={values[f.key] || ''} placeholder={(f as any).placeholder || 'התשובה שלך'}
                  onChange={e => set(f.key, e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              )}

              {f.type === 'textarea' && (
                <textarea
                  value={values[f.key] || ''} rows={3} placeholder="התשובה שלך"
                  onChange={e => set(f.key, e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
                />
              )}

              {f.type === 'radio' && (
                <div className="space-y-1.5">
                  {f.options.map(opt => (
                    <label key={opt} className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-slate-700/40">
                      <input type="radio" name={f.key} checked={values[f.key] === opt} onChange={() => set(f.key, opt)}
                        className="accent-primary-500 w-4 h-4" />
                      <span className="text-sm text-slate-300">{opt}</span>
                    </label>
                  ))}
                </div>
              )}

              {f.type === 'checkboxes' && (
                <div className="space-y-1.5">
                  {f.options.map(opt => (
                    <label key={opt} className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-slate-700/40">
                      <input type="checkbox" checked={(values[f.key] || []).includes(opt)} onChange={() => toggle(f.key, opt)}
                        className="accent-primary-500 w-4 h-4" />
                      <span className="text-sm text-slate-300">{opt}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}

          <button
            type="submit" disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-xl px-4 py-3 transition-colors disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {submitting ? 'שולח…' : 'שליחה'}
          </button>
        </form>
      </div>
    </div>
  );
}
