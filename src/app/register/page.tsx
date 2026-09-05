'use client';

import { useEffect, useState } from 'react';
import { Check, CheckCircle2 } from 'lucide-react';
import { Button, LoadingBlock } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * /register — the shareable public sign-up page. THE ONE TO SEND PEOPLE.
 *
 * It asks two things and stamps a third: email, which group they think they
 * belong to (optional), and the time they registered. Nothing else — not a name,
 * not a phone, not a watch. Everything else is asked after approval, in
 * /join/{token}, which is what the approval email links to.
 *
 * Hardcoded Hebrew rather than next-intl keys, like /academy-register: this page
 * is only ever opened from a link the club sends to Hebrew-speaking runners, and
 * it has no locale switcher to reach.
 *
 * Deliberately says the same thing whatever the address turns out to be — already
 * a member, already applied, or brand new. See the API route: telling those apart
 * would make a public form into a "is this person in the club?" lookup.
 *
 * ── LAYOUT: EVERYTHING ON ONE SCREEN ────────────────────────────────────────
 * The whole form is sized to fit a 390×844 phone without scrolling, which is why
 * the countdown is a compact card rather than a full-bleed hero and the choice
 * rows are 56px instead of the app's usual 64px. Someone opening a link from
 * WhatsApp decides whether to bother in the first second; a fold hiding the
 * submit button is the one thing that costs sign-ups here. If you add a field,
 * take the height from somewhere — do not let this page start scrolling.
 */

interface Group {
  id: string;
  name: string;
  /** 0-based band index from the API; -1 when the name isn't one of the three. */
  index: number;
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

/** "דבוקה 1/2/3" — the club calls them that out loud, and this page is Hebrew-only. */
const groupLabel = (g: Group) => (g.index >= 0 ? `דבוקה ${g.index + 1}` : g.name);

// When the app opens to the club — Wednesday, 20:00 Israel time. This is a LAUNCH
// date, not a training day: the countdown tells whoever registers when they can
// actually start using the thing. Change the hour here; nothing else depends on it.
const LAUNCH_HOUR = 20;

/** ms until the coming Wednesday at LAUNCH_HOUR; if it's already Wednesday past that
 *  hour, this rolls to next week rather than counting backwards. */
function msToNextWednesday(now = new Date()): number {
  const target = new Date(now);
  target.setHours(LAUNCH_HOUR, 0, 0, 0);
  const daysAhead = (3 - target.getDay() + 7) % 7; // 3 = Wednesday
  target.setDate(target.getDate() + daysAhead);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 7);
  return target.getTime() - now.getTime();
}

const DAY_MS = 86_400_000;

interface CountdownUnit {
  /** Stable react key AND the Hebrew caption under the numeral. */
  label: string;
  value: number;
  /** Zero-pad to two digits — minutes and seconds only, so they don't jitter. */
  pad?: boolean;
}

/**
 * How the remaining time is broken up. Always three blocks; what the last one
 * counts depends on how close the launch is.
 *
 * Over 24h: ימים + שעות + דקות. Under 24h the days block is dropped and seconds
 * take its place — launch night is the same day by then, so the ticking is the
 * point, where four days out it would just read as a deadline. Keeping the count
 * at three either way means the flip changes the labels and nothing else moves.
 *
 * Pure and exported so both modes and the boundary between them can be checked
 * without waiting for a Tuesday.
 */
export function countdownUnits(ms: number): CountdownUnit[] {
  // Clamped: msToNextWednesday() rolls forward to next week so this should never
  // be negative, but a clock skew must not render "-1 שניות".
  const total = Math.max(0, ms);
  const minutes = { label: 'דקות', value: Math.floor((total / 60_000) % 60), pad: true };
  if (total >= DAY_MS) {
    return [
      { label: 'ימים', value: Math.floor(total / DAY_MS) },
      { label: 'שעות', value: Math.floor((total / 3_600_000) % 24) },
      minutes,
    ];
  }
  return [
    { label: 'שעות', value: Math.floor(total / 3_600_000) },
    minutes,
    { label: 'שניות', value: Math.floor((total / 1_000) % 60), pad: true },
  ];
}

/**
 * The supporting sentence, which has to stay grammatical the whole way down.
 *
 * It always names the same units the numerals above it are showing, with their
 * values. It used to read "4 ימים ושעות" in the far case — the word שעות with no
 * number next to it, while an 8 sat in the block directly above — and that reads
 * as a bug, not as prose.
 *
 * Each unit is dropped as it hits zero: "עוד 0 שעות ו-0 דקות" in the last minute
 * is the kind of copy that makes a countdown look unfinished.
 */
export function launchSentence(ms: number): string {
  const [a, b, c] = countdownUnits(ms);
  const parts = ms >= DAY_MS
    ? [
        // "1 ימים" is not Hebrew. The numeral block above still shows a digit,
        // because a column of numerals wants to stay a column — the sentence is
        // the only place this has to read like a person wrote it.
        a.value === 1 ? 'יום' : `${a.value} ימים`,
        // Hidden rather than shown as a zero: at exactly four days the sentence
        // should say "עוד 4 ימים ו-3 דקות", not "…ו-0 שעות ו-3 דקות".
        b.value > 0 ? `${b.value} שעות` : '',
        c.value > 0 ? `${c.value} דקות` : '',
      ]
    : [
        a.value > 0 ? `${a.value} שעות` : '',
        b.value > 0 ? `${b.value} דקות` : '',
        // Seconds only get their own clause once they're the biggest thing left;
        // "עוד 3 שעות, 12 דקות ו-8 שניות" is more precision than anyone reads.
        // `c.value > 0` as well, or the last tick before launch reads
        // "עוד 0 שניות" instead of falling through to the "עוד רגע" line below.
        a.value === 0 && b.value === 0 && c.value > 0 ? `${c.value} שניות` : '',
      ];
  const named = parts.filter(Boolean);
  if (named.length === 0) return 'עוד רגע — האפליקציה נפתחת';
  // "עוד A ו-B" for two, "עוד A, B ו-C" for three — the ו- goes on the last one only.
  const last = named[named.length - 1];
  const head = named.slice(0, -1);
  const joined = head.length === 0 ? last : `${head.join(', ')} ו-${last}`;
  return `עוד ${joined} להשקת האפליקציה`;
}

/**
 * The countdown: the club's mark, then how long until the app opens.
 *
 * Strictly black and white, no brand blue anywhere on this page: it is the first
 * thing anyone outside the club ever sees, and the mark itself is a black
 * line-drawing — colour behind it only fights it.
 */
function LaunchCountdown() {
  // null on the first render so the server and client markup agree — a live clock
  // in SSR output is a hydration mismatch waiting to happen.
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    // Every second, in both modes. Minutes are always on screen, so a slower tick
    // would leave them visibly stale — up to half a minute wrong reads as a broken
    // clock, and that costs more than the render does.
    const tick = () => setLeft(msToNextWednesday());
    tick();
    const t = setInterval(tick, 1_000);
    return () => clearInterval(t);
  }, []);

  const units = countdownUnits(left ?? 0);

  return (
    <div className="rounded-card bg-card shadow-[0_4px_18px_rgba(0,0,0,0.07)] px-5 pt-6 pb-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/logo.png"
        alt="מדרגות — After 2KM Running Club"
        className="h-[54px] w-auto mx-auto object-contain"
      />

      <div className="h-px bg-ink-900/[0.07] mx-4 mt-5 mb-5" aria-hidden="true" />

      {/* Each numeral is labelled under itself. The label has to sit with its own
          number rather than in one sentence below: "4 · 8" alone reads as a time of
          day, and in RTL nobody can tell which half is which.
          Fixed height, tabular numerals and a zero-padded seconds pair: this box
          re-renders every second in the last day, and that is exactly where a
          layout that breathes with the digits gets noticed. The height is the same
          in both modes so nothing below it moves when the third unit appears. */}
      <div className="h-[70px] flex items-center justify-center">
        {units.map((u, i) => (
          <div key={u.label} className="flex-1 flex items-stretch">
            {i > 0 && <div className="w-px bg-ink-900/[0.08] my-1" aria-hidden="true" />}
            <div className="flex-1 text-center">
              {/* 44px is what three two-digit numerals fit at inside a 390px
                  screen. tabular-nums plus the zero padding below keeps the block
                  the same width digit to digit, which is the whole reason a
                  once-a-second clock doesn't visibly twitch. */}
              <div className="text-[44px] leading-[0.92] font-semibold text-ink-900 tabular-nums" dir="ltr">
                {left === null ? '·' : u.pad ? String(u.value).padStart(2, '0') : u.value}
              </div>
              <div className="mt-1.5 text-xs font-medium text-ink-500">{u.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Two lines' worth of height, always. The three-unit sentence wraps and the
          shorter ones don't, so without this the card grows and shrinks as the
          wording changes — once a minute, pushing the whole form down and back. */}
      <p className="mt-4 min-h-[45px] text-[15px] font-bold text-ink-900">
        {left === null ? 'להשקת האפליקציה' : launchSentence(left)}
      </p>
      <p className="mt-1.5 text-xs text-ink-500">יום רביעי, 20:00 — האפליקציה נפתחת.</p>
      {/* The academy opens later than the app, and saying so here stops the
          obvious wrong assumption: that this one form is the academy sign-up and
          Wednesday is the date for it. It is a separate registration, and it is
          NOT what the countdown is counting. */}
      {/* Weightier than a footnote and darker than the line above it: it is the
          one piece of information on this card that corrects an assumption, so
          being skimmable is the whole job. Still not bold — the countdown
          sentence has to stay the loudest thing in the card. */}
      <p className="mt-2 text-2xs font-semibold text-ink-700">ההרשמה לאקדמיה תיפתח מספר ימים לאחר ההשקה.</p>
    </div>
  );
}

/** The small grey caption above a grouped card — the iOS section-header idiom. */
function SectionCaption({ children }: { children: React.ReactNode }) {
  return <p className="px-2 mb-2 text-3xs font-semibold uppercase tracking-[0.09em] text-ink-400">{children}</p>;
}

/**
 * Addresses this BROWSER has already sent. Not a server check on purpose.
 *
 * The API answers `{ok:true}` identically for new / already-pending / already-a-
 * member, so the page cannot be told that an address is a repeat — that is the
 * whole anti-enumeration property and it must stay. But sending twice and getting
 * the same silent confirmation both times reads as "I registered twice", which is
 * exactly what Ofer reported. The DB is fine (a partial unique index over pending
 * emails means the second submit updates the first row rather than adding one);
 * only the screen was lying.
 *
 * localStorage is honest about what it actually knows: what happened on this
 * device. It reveals nothing about anyone else's address, so it can say so plainly.
 */
const SENT_KEY = 'madregot_register_sent';

function readSent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(SENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : [];
  } catch {
    // Private-mode or a corrupted value. The form still works without it; the
    // only thing lost is the "you already sent this" nicety.
    return [];
  }
}

function rememberSent(email: string) {
  try {
    const next = [...new Set([...readSent(), email])].slice(-10);
    window.localStorage.setItem(SENT_KEY, JSON.stringify(next));
  } catch {
    /* nothing to do — see readSent() */
  }
}

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  /** true when THIS browser had already sent this address before now. */
  const [repeat, setRepeat] = useState(false);
  /** The normalised address that was actually sent — what the success screen shows. */
  const [sentEmail, setSentEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The group field is optional, so a failure here is not worth surfacing —
    // the form still submits without it.
    fetch('/api/public/groups')
      .then(r => r.json())
      .then(d => setGroups(d.groups || []))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) { setError('צריך אימייל'); return; }
    // Normalised the same way the API does it, or "Ofer@Gmail.com" and
    // "ofer@gmail.com" would look like two different addresses to this check while
    // the server treats them as one.
    const normalised = email.trim().toLowerCase();
    const alreadySent = readSent().includes(normalised);
    setSubmitting(true);
    try {
      const res = await fetch('/api/public/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), groupId: groupId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error === 'invalid-email' ? 'האימייל לא נראה תקין' : 'ההרשמה נכשלה, נסו שוב');
      }
      // Still posted, even on a repeat: the request is idempotent server-side, and
      // it is how a corrected group choice gets saved. Only the wording changes.
      rememberSent(normalised);
      setSentEmail(normalised);
      setRepeat(alreadySent);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ההרשמה נכשלה, נסו שוב');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    // What happens next, in order, because "we'll be in touch" is the wording that
    // makes people register a second time. Each step says who acts — the coach, the
    // inbox, the app — so nobody is left waiting on a step that is not theirs.
    const steps = [
      'המאמן מאשר את ההרשמה.',
      'מגיע אליך מייל עם קישור להשלמת הפרטים — שם וחיבור השעון.',
      'ביום רביעי ב-20:00 האפליקציה נפתחת.',
    ];

    return (
      // White card on the page grey, the same as the form screen. This was a black
      // card, meant to mark the end of the flow, and it just read as a different
      // app: the mark inverted, the type inverted, nothing carried over from the
      // screen half a second earlier.
      <div className="min-h-[100dvh] bg-page flex items-center justify-center px-4 py-6" dir="rtl">
        <div className="w-full max-w-md">
          <div className="rounded-card bg-card px-5 pt-6 pb-6 text-center shadow-[0_4px_18px_rgba(0,0,0,0.07)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo.png"
              alt="מדרגות — After 2KM Running Club"
              className="h-[54px] w-auto mx-auto object-contain"
            />

            <div className="h-px bg-ink-900/[0.07] mx-4 mt-5 mb-5" aria-hidden="true" />

            <span className="w-11 h-11 rounded-full bg-ink-900 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-5 w-5 text-white" strokeWidth={2.5} />
            </span>

            {/* Two headings, because they answer two different questions. A repeat
                sender is asking "did it work the first time?", and "ההרשמה נשלחה"
                again does not answer that — it is why the same address got sent
                twice to begin with. */}
            <h2 className="mt-3.5 text-lg font-bold text-ink-900">
              {repeat ? 'הבקשה שלך כבר אצלנו' : 'ההרשמה נשלחה'}
            </h2>
            <p className="mt-1.5 text-2xs text-ink-500 leading-relaxed">
              {repeat
                ? 'שלחת את הכתובת הזאת כבר. היא רשומה פעם אחת בלבד — אין צורך לשלוח שוב.'
                : 'הכתובת נשמרה. אין מה לעשות עכשיו — נעדכן אותך במייל.'}
            </p>

            {/* The NORMALISED address, not what was typed. Someone who typed
                "Dana.Levi92@Gmail.com" is registered as lowercase, and showing
                them the capitals back invites them to wonder whether the two are
                the same record. They are. */}
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-pill bg-page px-3 py-1.5 text-3xs text-ink-500">
              הכתובת:
              <span dir="ltr" className="text-2xs font-semibold text-ink-900">{sentEmail}</span>
            </p>

            <div className="h-px bg-ink-900/[0.07] mx-4 mt-5 mb-4" aria-hidden="true" />

            {/* Numbered and right-aligned rather than a centred paragraph: this is a
                sequence, and centred RTL prose is where the previous version lost
                people — it said all three things in one breath. */}
            <ol className="text-right space-y-2.5">
              {steps.map((s, i) => (
                <li key={s} className="flex items-start gap-2.5">
                  <span className="mt-px w-[18px] h-[18px] shrink-0 rounded-full bg-ink-900 text-white text-3xs font-bold flex items-center justify-center tabular-nums">
                    {i + 1}
                  </span>
                  <span className="text-2xs text-ink-700 leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
          </div>

          <p className="mt-4 px-4 text-center text-2xs text-ink-400 leading-relaxed">
            לא הגיע מייל? כדאי לבדוק גם בספאם.
            <br />
            {/* Matched to the same weight it has on the form, so it doesn't look
                like an afterthought on the screen people actually stop and read. */}
            <span className="font-semibold text-ink-700">ההרשמה לאקדמיה תיפתח מספר ימים לאחר ההשקה.</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    // Page grey, not white: the cards are white and unbordered, so the grey behind
    // them is the only thing separating them from the canvas.
    <div className="min-h-[100dvh] bg-page" dir="rtl">
      {/* justify-center, NOT a bottom-pinned button: on a 390×844 phone there are
          ~130px of slack, and anchoring the button to the bottom collected all of
          it into one hole between the form and the button, which read as a
          rendering fault. Centred, the same slack splits above and below and looks
          like margin. */}
      <div className="max-w-md mx-auto min-h-[100dvh] flex flex-col justify-center px-4 py-6">
        <LaunchCountdown />

        <form onSubmit={submit} className="flex flex-col">
          <div className="mt-6">
            <SectionCaption>פרטי הרשמה</SectionCaption>
            <div className="rounded-card bg-card overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
              <div className="px-4 py-3.5 border-b border-page">
                <label htmlFor="reg-email" className="block text-3xs text-ink-400">
                  אימייל <span className="text-accent-red">*</span>
                </label>
                <input
                  id="reg-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  dir="ltr"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  // Borderless and transparent: inside a grouped card the row IS
                  // the field, and a second box drawn inside a card reads as a
                  // dialog in a dialog.
                  className="mt-0.5 w-full bg-transparent border-0 p-0 text-sm text-ink-900 placeholder-ink-400 text-left focus:outline-none focus:ring-0"
                />
              </div>

              <p className="px-4 pt-3.5 pb-2 text-3xs text-ink-400">לאיזו דבוקה את/ה משתייך?</p>

              {/* One row per choice, "not sure" last. The radio input is visually
                  hidden and a trailing check mark stands in for it — an iOS
                  grouped list marks the selected row, it does not draw a dial. */}
              {[
                ...groups.map(g => ({
                  id: g.id,
                  label: groupLabel(g),
                  hint: g.marathonGoal || '',
                })),
                // "Not sure" is a real answer, and the commonest one from someone
                // new — group_id is nullable exactly so it can be given. Without
                // this row, an unsure runner either guesses or gives up, and the
                // coach assigns the group at approval anyway.
                { id: '', label: 'לא בטוח/ה — שהמאמן יחליט', hint: '' },
              ].map((opt, i, all) => {
                const selected = groupId === opt.id;
                return (
                  <label
                    key={opt.id || 'unsure'}
                    className={cn(
                      'flex items-center gap-3 h-[56px] px-4 cursor-pointer',
                      // Hairlines stop short of the card edge and the last row has
                      // none — inset dividers, not a table.
                      i < all.length - 1 && 'border-b border-page mx-0',
                    )}
                  >
                    <input
                      type="radio"
                      name="group"
                      checked={selected}
                      onChange={() => setGroupId(opt.id)}
                      className="sr-only"
                    />
                    <span className="flex-1 flex items-baseline gap-2">
                      {/* Deliberately NOT the app's band colours (green/blue/orange):
                          this page is black-and-white, so the groups are told apart
                          by their number, which is what the club says out loud. */}
                      <span className={cn('text-sm', selected ? 'font-semibold text-ink-900' : 'text-ink-700')}>
                        {opt.label}
                      </span>
                      {opt.hint && <span dir="ltr" className="text-3xs text-ink-400">{opt.hint}</span>}
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-ink-900" strokeWidth={3} />}
                  </label>
                );
              })}
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-accent-red text-center">{error}</p>}

          <div className="h-5" />

          {/* Black, not the brand blue this Button defaults to — the whole page is
              mono, and cn()'s tailwind-merge lets the later class win. */}
          <Button
            type="submit"
            size="lg"
            disabled={submitting}
            className="w-full h-[52px] rounded-pill bg-ink-900 text-white hover:bg-ink-700 text-[15px] font-semibold shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
          >
            {submitting && <LoadingBlock size={20} className="py-0" />}
            {submitting ? 'שולח…' : 'שליחה'}
          </Button>

          <p className="mt-2.5 px-3 text-center text-2xs text-ink-400 leading-relaxed">
            ההרשמה טעונה אישור של המאמן. עד אז אין גישה לאפליקציה.
          </p>
        </form>
      </div>
    </div>
  );
}
