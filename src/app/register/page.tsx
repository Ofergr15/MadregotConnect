'use client';

import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Mail } from 'lucide-react';
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
 * ⚠️ The scrim is not decoration, and it is doing MORE work than it used to.
 * There is no card on this page any more — every piece of type, down to the 10px
 * footnotes, sits directly on the photograph, so the scrim is the only thing
 * standing between the copy and a bright patch of sky or sunlit concrete. White
 * type measures under 2:1 on this photo unscrimmed.
 *
 * Three stops, not two: the middle of the frame is where the runners are and is
 * already dark, but the top (sky, pale concrete) and the bottom (the footnotes,
 * at 10px the most fragile type here) both need more. Anything that lightens
 * these values has to be checked against the brightest pixel in the photo, not
 * against the average. If the photo is ever swapped, re-measure before adjusting.
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
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/55 to-black/85" />
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
      {/* TEXT_ON_PHOTO: the scrim alone leaves the headline sitting on whatever
          happens to be behind it. A soft shadow is what keeps the letterforms
          separated from a bright patch — cheaper and less destructive than
          darkening the scrim until the photo stops being a photo. */}
      <h1 className={cn('mt-3 short:mt-2 text-[30px] short:text-[24px] font-bold leading-[1.08] text-white', TEXT_ON_PHOTO)}>
        אפליקציית המדרגות
      </h1>
      <p className={cn('mt-2 short:mt-1 text-13 short:text-2xs font-semibold tracking-[0.22em] text-white/90', TEXT_ON_PHOTO)}>
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
    <div className={cn('h-[52px] short:h-[44px] flex items-center justify-center', TEXT_ON_PHOTO)}>
      {units.map((u, i) => (
        <div key={u.label} className="flex-1 flex items-stretch">
          {i > 0 && <div className="w-px bg-white/25 my-0.5" aria-hidden="true" />}
          <div className="flex-1 text-center">
            <div className="text-[26px] short:text-[22px] leading-[1.05] font-bold text-white tabular-nums" dir="ltr">
              {left === null ? '·' : u.pad ? String(u.value).padStart(2, '0') : u.value}
            </div>
            {/* Each numeral is labelled under itself. The label has to sit with
                its own number rather than in one sentence below: "4 · 8" alone
                reads as a time of day, and in RTL nobody can tell which half is
                which. */}
            <div className="mt-0.5 text-3xs font-medium text-white/90">{u.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The sponsor line that closes the page — a rule, the wordmark, a rule.
 *
 * Letterspaced small caps rather than a logo file: there is no HOKA asset in this
 * repo, and inventing one from a web image would put someone else's trademark
 * into the build at whatever resolution happened to be lying around. Type the
 * club can set itself is the honest version, and it is what the reference design
 * does with its own wordmark in this slot.
 *
 * The rules are flex-1 and the label is not, so the pair always centres on the
 * wordmark whatever the screen width — no magic widths to re-tune at 320px.
 * ⚠️ `ms-*`/`me-*` on the label, not `gap-*`: Safari only got flexbox gap in
 * 14.1 and this page has to lay out on an iPhone 6.
 */
function PoweredBy() {
  return (
    <div className="mt-3 short:mt-2 flex items-center justify-center" aria-label="Powered by HOKA">
      <span className="h-px flex-1 max-w-[52px] bg-white/25" aria-hidden="true" />
      <span className="ms-3 me-3 text-4xs font-semibold uppercase tracking-[0.3em] text-white/80">
        Powered by HOKA
      </span>
      <span className="h-px flex-1 max-w-[52px] bg-white/25" aria-hidden="true" />
    </div>
  );
}

/**
 * A soft shadow for white type sitting directly on the photograph.
 *
 * ⚠️ Every piece of copy on this page is on the photo — there is no card. The
 * scrim in HeroBackdrop gets the average luminance down, but a photo has local
 * highlights (a shoulder, a patch of sky, the sunlit track) and the scrim cannot
 * see them. This is what stops a letterform dissolving into one. Applied to the
 * headline, the countdown and the footnotes; NOT to the fields and pills, which
 * carry their own tinted backgrounds instead.
 *
 * Cheap in the right way: darkening the scrim until the type is safe everywhere
 * would mean darkening it until the photograph stops reading as a photograph,
 * which is the whole point of the page.
 */
const TEXT_ON_PHOTO = '[text-shadow:0_1px_8px_rgba(0,0,0,0.65)]';

/**
 * The shared skin for the two interactive surfaces on the photo — the email
 * field and the דבוקה pills.
 *
 * A tint plus a blur, not a solid fill: the photo has to keep showing through or
 * the page is back to being cards on a background, which is what this design
 * replaced. `bg-white/10` over the scrim is enough to hold 15px white type at
 * 7:1 while still reading as glass. `backdrop-blur-sm` is what handles the case
 * the tint can't — a hard bright edge (a white singlet) crossing behind a row.
 *
 * ⚠️ `-webkit-backdrop-filter` is what iOS actually implements, and Tailwind
 * emits both spellings for `backdrop-blur-*`. Do not hand-roll this in a style
 * attribute or it silently does nothing on every iPhone.
 */
const FIELD = 'rounded-pill border bg-white/10 backdrop-blur-sm';

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
      // Same photo, same type on it, no card here either. Landing on a
      // different-looking screen half a second after submitting reads as a
      // different app, which is what the white card this replaced used to do.
      <div className="relative min-h-screen min-h-[100dvh]" dir="rtl">
        <HeroBackdrop />
        <div className="relative max-w-md mx-auto min-h-screen min-h-[100dvh] flex flex-col px-5 pt-6 pb-5 short:pt-3 short:pb-2">
          <HeroHeading />

          <div className={cn('text-center', TEXT_ON_PHOTO)}>
            {/* Solid white disc: the one filled shape on a page of outlines, so
                the outcome is legible before a word of it is read. */}
            <span className="w-11 h-11 rounded-full bg-white flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-5 w-5 text-ink-900" strokeWidth={2.5} />
            </span>

            {/* A different heading per outcome: someone resubmitting is asking
                "did the first one work?", and "ההרשמה נשלחה" a second time does not
                answer that — which is why the same address got sent twice. */}
            <h2 className="mt-3.5 short:mt-2.5 text-lg font-bold text-white">{copy.title}</h2>
            <p className="mt-2 short:mt-1.5 text-2xs text-white/90 leading-relaxed">{copy.line}</p>

            {/* The NORMALISED address, not what was typed. Someone who typed
                "Dana.Levi92@Gmail.com" is registered as lowercase, and showing
                them the capitals back invites them to wonder whether the two are
                the same record. They are. */}
            <p className={cn('mt-4 short:mt-2.5 inline-flex items-center border-white/25 px-3 py-1.5 text-3xs text-white/90', FIELD)}>
              הכתובת:
              <span dir="ltr" className="me-1.5 text-2xs font-semibold text-white">{sentEmail}</span>
            </p>
          </div>

          <div className="flex-1 min-h-0" />

          <p className={cn('px-2 text-center text-2xs short:text-3xs leading-relaxed', TEXT_ON_PHOTO)}>
            <span className="text-white/90">לא הגיע מייל? כדאי לבדוק גם בספאם.</span>
            <br />
            <span className="font-semibold text-white">ההרשמה לאקדמיה תיפתח מספר ימים לאחר ההשקה.</span>
          </p>

          <PoweredBy />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen min-h-[100dvh]" dir="rtl">
      <HeroBackdrop />

      {/* px-5, and nothing between the fields and the photo. The card that used to
          hold all of this is gone: the form IS the page now, which is why the
          hero above it is `flex-1` and takes every pixel of slack. */}
      <div className="relative max-w-md mx-auto min-h-screen min-h-[100dvh] flex flex-col px-5 pt-6 pb-5 short:pt-3 short:pb-2">
        <HeroHeading />

        <form onSubmit={submit}>
          {/* No visible label — the placeholder and the envelope say what this is,
              and on a page with one field a label above it is a row of type that
              buys nothing. The <label> is still here for screen readers. */}
          <label htmlFor="reg-email" className="sr-only">אימייל</label>
          <div className={cn('flex items-center h-[52px] short:h-[46px] border-white/25 px-4 focus-within:border-white', FIELD)}>
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
              className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-white placeholder-white/60 text-left focus:outline-none focus:ring-0"
            />
            {/* Last in the DOM, so in RTL it lands on the LEFT — the far end from
                where Hebrew starts, and the end the LTR address runs toward.
                ⚠️ `ms-`, not `me-`: this icon has no dir of its own, so it follows
                the RTL parent and margin-inline-START is its RIGHT side, which is
                the side the input is on. */}
            <Mail className="ms-3 h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
          </div>

          {/* "מועדפת" is carrying real weight: the picker used to have a
              "לא בטוח/ה — שהמאמן יחליט" row, which was both the escape hatch AND
              the thing that made the question look answerable-by-skipping. With
              that row gone, "לאיזו דבוקה את/ה משתייך?" over three pills reads as
              required, and an unsure runner would guess rather than leave it. A
              PREFERENCE is obviously optional, and group_id is nullable — the
              coach assigns it at approval either way. */}
          <p className={cn('mt-4 short:mt-2.5 mb-2 text-center text-2xs short:text-3xs text-white/90', TEXT_ON_PHOTO)}>
            בחרו דבוקה מועדפת
          </p>

          {/* Three abreast, each with a dial. The radio input itself is visually
              hidden and the dial stands in for it — but unlike the old list, the
              dial is DRAWN: with no card behind these, "selected" had to be
              readable from the pill alone, and a fill change on glass is too
              subtle on a photo that is already busy.
              ⚠️ `ms-2` for the inter-pill gap, not `gap-2`: Safari only got
              flexbox gap in 14.1, and this page has to lay out on an iPhone 6. */}
          <div className="flex">
            {groups.map((g, i) => {
              const selected = groupId === g.id;
              return (
                <label
                  key={g.id}
                  className={cn(
                    'flex-1 min-w-0 flex items-center justify-center h-[54px] short:h-[46px] cursor-pointer px-2',
                    FIELD,
                    i > 0 && 'ms-2',
                    // Orange, the page's one accent — the same token as the rule
                    // under the headline and the button below.
                    selected ? 'border-band-3 bg-band-3/25' : 'border-white/25',
                  )}
                >
                  <input type="radio" name="group" checked={selected} onChange={() => setGroupId(g.id)} className="sr-only" />
                  <span className="min-w-0 text-center">
                    <span className={cn('block text-2xs font-semibold leading-tight', selected ? 'text-band-3' : 'text-white')}>
                      {groupLabel(g)}
                    </span>
                    {g.marathonGoal && (
                      <span dir="ltr" className="block text-4xs leading-tight text-white/80">{g.marathonGoal}</span>
                    )}
                  </span>
                  {/* The dial, last so RTL puts it on the left of the label. A
                      filled orange disc when chosen, an empty ring when not. */}
                  <span
                    className={cn(
                      'ms-2 h-[18px] w-[18px] shrink-0 rounded-full flex items-center justify-center',
                      selected ? 'bg-band-3' : 'border-[1.5px] border-white/50',
                    )}
                    aria-hidden="true"
                  >
                    {selected && <Check className="h-3 w-3 text-white" strokeWidth={3.5} />}
                  </span>
                </label>
              );
            })}
          </div>

          {/* Solid red fill rather than red text: `accent-red` is tuned for AA on
              the app's light surfaces and measures under 2:1 on a dark photo, so
              the error would have been the least readable thing on screen. */}
          {error && (
            <p className="mt-3 rounded-pill bg-accent-red px-3 py-1.5 text-center text-2xs font-semibold text-white">{error}</p>
          )}

          {/* ⚠️ 19px BOLD is a contrast requirement, not a style choice: white on
              #FF5315 measures 3.22:1, which passes WCAG AA only as large text
              (≥18.66px bold). Shrinking or unbolding this label fails AA. */}
          <Button
            type="submit"
            size="lg"
            disabled={submitting}
            className="mt-3.5 short:mt-2.5 w-full h-[54px] short:h-[48px] rounded-pill bg-band-3 text-white hover:bg-band-3/90 text-[19px] font-bold shadow-[0_6px_22px_rgba(255,83,21,0.45)]"
          >
            {submitting && <LoadingBlock size={20} className="py-0" />}
            {submitting ? 'שולח…' : 'שליחה'}
          </Button>
        </form>

        <div className="mt-4 short:mt-2.5 h-px bg-white/20" aria-hidden="true" />

        <div className="mt-2 short:mt-1">
          <CountdownRow />
        </div>

        {/* Both footnotes sit on the photo under the clock. The academy line is the
            weightier of the two: it corrects an assumption (that this form is the
            academy sign-up and the countdown is counting to it), where the approval
            line only confirms what pressing the button does. */}
        <p className={cn('mt-2 short:mt-1 px-2 text-center text-2xs short:text-3xs leading-relaxed', TEXT_ON_PHOTO)}>
          <span className="font-semibold text-white">ההרשמה לאקדמיה תיפתח מספר ימים לאחר ההשקה.</span>
          <br />
          <span className="text-white/90">ההרשמה טעונה אישור של מנהלי המדרגות. עד אז אין גישה לאפליקציה.</span>
        </p>

        <PoweredBy />
      </div>
    </div>
  );
}
