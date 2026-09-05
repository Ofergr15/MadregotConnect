'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Mail } from 'lucide-react';
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
 * ── LAYOUT: A PHOTO HERO WITH ONE CARD ON IT ────────────────────────────────
 * Full-bleed club photo, the mark and the headline on it, and everything that is
 * asked for inside a single white card floating at the bottom. This is a landing
 * page, not a settings screen: it is sent cold over WhatsApp to people who have
 * never seen the app, and the photo is what says what the club is before anyone
 * reads a word.
 *
 * ── EVERYTHING ON ONE SCREEN ────────────────────────────────────────────────
 * Still sized to fit a 390×844 phone without scrolling. Someone opening a link
 * from WhatsApp decides whether to bother in the first second; a fold hiding the
 * submit button is the one thing that costs sign-ups here. If you add a field,
 * take the height from somewhere — do not let this page start scrolling.
 *
 * The דבוקה picker is three pills abreast, not the four stacked 52px rows it used
 * to be. That is what paid for the photo: 208px of list became 46px of pills, and
 * the hero got the difference. Going back to stacked rows means dropping the hero.
 *
 * `short:` (max-height 720px, defined in tailwind.config) is the same layout
 * scaled down for phones that are not 844px tall. An iPhone 6 is 667px and put the
 * submit button 169px below the fold; every `short:` on this page exists to buy
 * that back. Test any height change at BOTH 390×844 and 375×667.
 *
 * Two things this page must keep working on an iPhone 6, which tops out at iOS 12:
 * no `dvh` (hence `min-h-screen` before every `min-h-[100dvh]`, as the fallback
 * an unsupported unit falls back to) and no flexbox `gap` (hence `ms-*` margins
 * where a gap would be idiomatic — Safari only got gap in 14.1).
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
 * The photo the whole page sits on, plus the scrim that makes white type legible
 * over it.
 *
 * `absolute inset-0` on a plain <img> rather than a CSS `background-image`: the
 * photo is content here (it is the only thing on screen for the first beat), so
 * it gets an `alt`, it gets `fetchPriority`, and it fails to a solid dark plate
 * instead of a white page with black text on it.
 *
 * ⚠️ The scrim is not decoration. Over the bright sky in the top third of this
 * photo, white type measures under 2:1 unscrimmed. Two stops, darker at the
 * bottom, because the bottom is where the card's own shadow has to read as depth
 * rather than as a smudge. If the photo is ever swapped, re-check the headline
 * against the new sky before touching these values.
 */
function HeroBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink-900" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/hero-running.jpg"
        alt=""
        // Above the fold and the largest paint on the page — this is the LCP
        // element, so it must not be lazy.
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/50 to-black/85" />
    </div>
  );
}

/**
 * The club's mark and what is being launched, white on the photo.
 *
 * `logo-white.png`, not the black `logo.png` the card used to show: the mark is a
 * line drawing, and the black one disappears into a dark photo.
 */
function HeroHeading() {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/logo-white.png"
        alt="מדרגות — After 2KM Running Club"
        className="h-[78px] short:h-[54px] w-auto object-contain"
      />

      {/* Says what the thing being launched IS, and that this is the launch. A
          countdown with no subject is a puzzle — especially for the people this
          link is sent to, who have never seen the app. */}
      <h1 className="mt-3 short:mt-2 text-[30px] short:text-[24px] font-bold leading-[1.08] text-white">
        אפליקציית המדרגות
      </h1>
      <p className="mt-2 short:mt-1 text-13 short:text-2xs font-semibold tracking-[0.22em] text-white/75">
        ההשקה
      </p>
      {/* The one piece of colour on the page. Squad-3 orange (#FF5315) is already
          in the palette, so the accent here and the CTA below are the same token
          the app uses elsewhere rather than a colour invented for this page. */}
      <div className="mt-3.5 short:mt-2 h-[3px] w-11 rounded-pill bg-band-3" />
    </div>
  );
}

/**
 * How long until the app opens — the LAST thing in the card, under the button.
 *
 * ⚠️ Nothing else about the time goes on this page. Two lines have already been
 * tried and removed from next to this clock: a generated sentence ("עוד 4 ימים,
 * 4 שעות ו-11 דקות להשקת האפליקציה") that restated the three numerals word for
 * word, and then a bold date line ("יום רביעי, 20:00 — האפליקציה נפתחת"), which
 * was a second way of saying the same thing to somebody already looking at a
 * live clock. The countdown says it once. That is the design, not an oversight.
 */
function CountdownRow() {
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
    // Fixed height, tabular numerals and a zero-padded pair: this box re-renders
    // every second in the last day, and that is exactly where a layout that
    // breathes with the digits gets noticed. The height is the same in both modes
    // so nothing moves when the third unit changes.
    <div className="h-[52px] short:h-[44px] flex items-center justify-center">
      {units.map((u, i) => (
        <div key={u.label} className="flex-1 flex items-stretch">
          {i > 0 && <div className="w-px bg-white/15 my-0.5" aria-hidden="true" />}
          <div className="flex-1 text-center">
            <div className="text-[26px] short:text-[22px] leading-[1.05] font-bold text-white tabular-nums" dir="ltr">
              {left === null ? '·' : u.pad ? String(u.value).padStart(2, '0') : u.value}
            </div>
            {/* Each numeral is labelled under itself. The label has to sit with
                its own number rather than in one sentence below: "4 · 8" alone
                reads as a time of day, and in RTL nobody can tell which half is
                which. */}
            <div className="mt-0.5 text-3xs font-medium text-white/80">{u.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The small caption at the top of the glass panel — the iOS section-header idiom.
 *
 * white/80, not a grey: the panel is a dark tint of the photo behind it, and
 * anything lighter than 80% fails AA at this size against the brightest patch of
 * that photo. See the note on GLASS below.
 */
function SectionCaption({ children }: { children: React.ReactNode }) {
  return <p className="px-2 mb-2 short:mb-1 text-3xs font-semibold uppercase tracking-[0.09em] text-white/80">{children}</p>;
}

/**
 * The panel everything is asked for inside — the photo's own colour, not white.
 *
 * ⚠️ `bg-ink-900/80` is a CONTRAST floor, not a taste setting. The panel takes its
 * colour from the photo showing through it, so its own luminance moves with
 * whatever pixel is behind it, and the brightest patch of hero-running.jpg (the
 * sunlit track) is the binding case. Measured over that patch:
 *   /55 → white body text 4.3:1, white/80 captions 2.7:1  — captions fail AA
 *   /70 → 5.7:1 / 3.7:1                                    — captions still fail
 *   /80 → 7.3:1 / 4.7:1                                    — both clear AA
 * So the tint cannot be lightened to show more of the photo without also
 * darkening the secondary text. `backdrop-blur-xl` is doing real work here too:
 * it averages the sunlit patch away instead of leaving a bright band under one
 * corner of the type.
 */
const GLASS =
  'rounded-card bg-ink-900/80 backdrop-blur-xl border border-white/15 shadow-[0_18px_50px_rgba(0,0,0,0.45)]';

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
  /**
   * What the address turned out to be, as the server reports it:
   * 'new' — first time; 'pending' — already waiting for approval;
   * 'member' — already has an account.
   */
  const [state, setState] = useState<'new' | 'pending' | 'member'>('new');
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
      // The server knows whether this address is already a member or already
      // queued; localStorage only knows about this device, so it is the fallback
      // for an older deployment or a response without the field.
      setState(data.state === 'member' || data.state === 'pending' ? data.state : alreadySent ? 'pending' : 'new');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ההרשמה נכשלה, נסו שוב');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    // One heading and one line each. The three-step list that was here said too
    // much — the only thing anyone needs is WHEN the mail arrives.
    const copy = {
      new: {
        title: 'ההרשמה נשלחה',
        line: 'ביום רביעי ב-20:00 יתחילו להישלח המיילים עם הקישור לכניסה לאפליקציה.',
      },
      pending: {
        title: 'כבר נרשמת',
        line: 'הכתובת הזאת כבר בהרשמה. ביום רביעי ב-20:00 יתחילו להישלח המיילים עם הקישור לכניסה לאפליקציה.',
      },
      // Not "you already applied" — this address has an account. Saying so is what
      // stops a member re-registering and waiting for a mail that isn't coming.
      member: {
        title: 'הכתובת הזאת כבר רשומה',
        line: 'יש לך כבר חשבון במדרגות, אין צורך להירשם שוב. ביום רביעי ב-20:00 יתחילו להישלח המיילים עם הקישור לכניסה לאפליקציה.',
      },
    }[state];

    return (
      // Same photo and same panel as the form screen. This was a white card on
      // page grey, and before that a black one; either way, landing on a
      // different-looking screen half a second after submitting reads as a
      // different app. Nothing about the surface changes — only the contents.
      <div className="relative min-h-screen min-h-[100dvh]" dir="rtl">
        <HeroBackdrop />
        <div className="relative max-w-md mx-auto min-h-screen min-h-[100dvh] flex flex-col px-4 pt-6 pb-5 short:pt-3 short:pb-2">
          <HeroHeading />

          <div className={cn(GLASS, 'mt-4 short:mt-2 px-5 pt-5 pb-5 short:pt-3.5 short:pb-3.5 text-center')}>
            <span className="w-11 h-11 rounded-full bg-white flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-5 w-5 text-ink-900" strokeWidth={2.5} />
            </span>

            {/* A different heading per outcome: someone resubmitting is asking
                "did the first one work?", and "ההרשמה נשלחה" a second time does not
                answer that — which is why the same address got sent twice. */}
            <h2 className="mt-3.5 short:mt-2.5 text-lg font-bold text-white">{copy.title}</h2>
            <p className="mt-2 short:mt-1.5 px-1 text-2xs text-white/80 leading-relaxed">{copy.line}</p>

            {/* The NORMALISED address, not what was typed. Someone who typed
                "Dana.Levi92@Gmail.com" is registered as lowercase, and showing
                them the capitals back invites them to wonder whether the two are
                the same record. They are. */}
            <p className="mt-4 short:mt-2.5 inline-flex items-center rounded-pill bg-white/10 px-3 py-1.5 text-3xs text-white/80">
              הכתובת:
              <span dir="ltr" className="me-1.5 text-2xs font-semibold text-white">{sentEmail}</span>
            </p>
          </div>

          <p className="mt-3.5 short:mt-2 px-4 text-center text-2xs short:text-3xs text-white/80 leading-relaxed">
            לא הגיע מייל? כדאי לבדוק גם בספאם.
            <br />
            <span className="font-semibold text-white">ההרשמה לאקדמיה תיפתח מספר ימים לאחר ההשקה.</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen min-h-[100dvh]" dir="rtl">
      <HeroBackdrop />

      {/* Not justify-center: the hero takes the slack (it is `flex-1`) and the
          panel sits at the bottom where a thumb is. Centring the whole column
          instead left a hole under it that read as a rendering fault. */}
      <div className="relative max-w-md mx-auto min-h-screen min-h-[100dvh] flex flex-col px-4 pt-6 pb-5 short:pt-3 short:pb-2">
        <HeroHeading />

        <form onSubmit={submit} className={cn(GLASS, 'mt-4 short:mt-2 px-4 pt-4 pb-4 short:pt-3 short:pb-3')}>
          <SectionCaption>פרטי הרשמה</SectionCaption>

          {/* An outlined pill, not a borderless row: there is one field on this
              panel, and a bare line of text with no box around it does not read as
              somewhere to type. */}
          <label htmlFor="reg-email" className="sr-only">אימייל</label>
          <div className="flex items-center h-[46px] short:h-[42px] rounded-pill border border-white/30 bg-white/5 px-4 focus-within:border-white">
            <Mail className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
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
              // ⚠️ `me-`, not `ms-`. This element carries its own dir="ltr" inside
              // an RTL parent, so margin-inline-START resolves to its LEFT — the
              // far side from the icon — and the gap lands in the wrong place.
              className="me-2.5 flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-white placeholder-white/50 text-left focus:outline-none focus:ring-0"
            />
          </div>

          {/* "(לא חובה)" is not decoration: the picker used to carry a
              "לא בטוח/ה — שהמאמן יחליט" row, which was both the escape hatch AND
              the thing that made the question look answerable-by-skipping. With
              that row gone, three pills and nothing else read as required, and an
              unsure runner would guess a דבוקה rather than leave it. group_id is
              nullable and the coach assigns it at approval either way, so saying
              so in the label is what keeps the honest answer available. */}
          <p className="mt-3 short:mt-2 mb-2 short:mb-1.5 px-1 text-3xs text-white/80">
            לאיזו דבוקה את/ה משתייך? <span className="text-white/60">(לא חובה)</span>
          </p>

          {/* Three pills abreast. The radio input is visually hidden and the
              selected pill fills solid white — the same idiom as a segmented
              control, which is what this is.
              ⚠️ `ms-2` for the inter-pill gap, not `gap-2`: Safari only got
              flexbox gap in 14.1, and this page has to lay out on an iPhone 6.
              These pills have no dir of their own, so they follow the RTL parent
              and margin-inline-start is the RIGHT side — toward the previous pill. */}
          <div className="flex">
            {groups.map((g, i) => {
              const selected = groupId === g.id;
              return (
                <label
                  key={g.id}
                  className={cn(
                    'flex-1 min-w-0 flex flex-col items-center justify-center h-[46px] short:h-[42px] rounded-pill border cursor-pointer',
                    i > 0 && 'ms-2',
                    selected ? 'border-white bg-white' : 'border-white/30 bg-white/5',
                  )}
                >
                  <input type="radio" name="group" checked={selected} onChange={() => setGroupId(g.id)} className="sr-only" />
                  {/* Deliberately NOT the app's band colours: the one accent on
                      this page is the orange CTA, and three coloured pills next to
                      it would leave nothing looking like the thing to press. */}
                  <span className={cn('text-2xs font-semibold leading-tight', selected ? 'text-ink-900' : 'text-white')}>
                    {groupLabel(g)}
                  </span>
                  {g.marathonGoal && (
                    <span dir="ltr" className={cn('text-4xs leading-tight', selected ? 'text-ink-500' : 'text-white/70')}>
                      {g.marathonGoal}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {/* Solid red fill rather than red text: `accent-red` is tuned for AA on
              the app's light surfaces and measures under 2:1 on this dark panel,
              so the error would have been the least readable thing on screen. */}
          {error && (
            <p className="mt-2.5 rounded-pill bg-accent-red px-3 py-1.5 text-center text-2xs font-semibold text-white">{error}</p>
          )}

          {/* Squad-3 orange, the page's one accent — see HeroHeading.
              ⚠️ 19px BOLD is a contrast requirement, not a style choice: white on
              #FF5315 measures 3.22:1, which passes WCAG AA only as large text
              (≥18.66px bold). Shrinking or unbolding this label fails AA. */}
          <Button
            type="submit"
            size="lg"
            disabled={submitting}
            className="mt-3 short:mt-2 w-full h-[50px] short:h-[46px] rounded-pill bg-band-3 text-white hover:bg-band-3/90 text-[19px] font-bold shadow-[0_4px_16px_rgba(255,83,21,0.35)]"
          >
            {submitting && <LoadingBlock size={20} className="py-0" />}
            {submitting ? 'שולח…' : 'שליחה'}
          </Button>

          <div className="h-px bg-white/15 mt-3.5 mb-1.5 short:mt-2 short:mb-0.5" aria-hidden="true" />

          <CountdownRow />
        </form>

        {/* Both footnotes live on the photo, below the panel — the panel holds only
            what is being asked for. The academy line is the weightier of the two:
            it corrects an assumption (that this form is the academy sign-up and the
            countdown is counting to it), where the approval line only confirms what
            pressing the button does. */}
        <p className="mt-3.5 short:mt-2 px-3 text-center text-2xs short:text-3xs leading-relaxed">
          <span className="font-semibold text-white">ההרשמה לאקדמיה תיפתח מספר ימים לאחר ההשקה.</span>
          <br />
          <span className="text-white/80">ההרשמה טעונה אישור של מנהלי המדרגות. עד אז אין גישה לאפליקציה.</span>
        </p>
      </div>
    </div>
  );
}
