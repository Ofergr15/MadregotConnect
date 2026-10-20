'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';

// ═════════════════════════════════════════════════════════════════════════════
// THE LIVE TOUR (2026-10-19) — the app showing itself, on the member's real screens.
//
// Ofer, after installing as a new member: "it should really press a tab and it
// opens, press a story and you're in, go to More, then photos, open a photo —
// something real, not a gimmick". So this tour does not draw pictures of the app:
// a finger glides to the real tab or circle, presses it (a real click), the real
// page or story opens with the member's own data, and only then one calm card
// explains what they are looking at, with the rest of the screen dimmed around it.
//
// Every step finds its element at the moment it runs, mostly by what the member
// sees (a tab's label, a section's title), and a step whose element is not there
// (no photos yet, no stories today) is passed over, never stuck on. Started by the
// event below; while being tried it is the super user's only (BottomTabBar).
// ═════════════════════════════════════════════════════════════════════════════

export const LIVE_TOUR_EVENT = 'mc:live-tour-start';
export function startLiveTour(): void { window.dispatchEvent(new Event(LIVE_TOUR_EVENT)); }

type Find = () => HTMLElement | null;
type Act = { tap: Find } | { key: 'Escape' } | { go: string } | { wait: number }
  /** A finger swipe across the screen, then `el` scrolled into view — the next photo in a gallery. */
  | { swipe: Find };
interface Step {
  /** What the finger does to bring this step's screen up, in order. */
  acts?: Act[];
  /** What to light up once it is there; absent = the whole screen (a story, a photo). */
  spot?: Find;
  /** Light up from the element down to the tab bar (a page's content, not one card). */
  spotBelow?: boolean;
  title: string;
  body: string;
  /** Skip the step when this is missing (nothing to show), checked after the acts. */
  needs?: Find;
  /** Skip the step at once, before any finger moves, when this is not on screen (a tab this member does not have). */
  only?: Find;
  /** How long `needs` may take to show up (a run page loads its streams). */
  needsMs?: number;
}

const visible = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const q = (sel: string): Find => () => Array.from(document.querySelectorAll<HTMLElement>(sel)).find(visible) ?? null;
/** The innermost visible element whose own text is `text`, climbed to the clickable/carded thing around it. */
const byText = (text: string, climb = 'button, a, [role="tab"]'): Find => () => {
  const all = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="tab"], p, span, div, h1, h2, h3'));
  const hit = all.filter((el) => visible(el) && el.textContent?.trim() === text);
  const el = hit[hit.length - 1] ?? null;
  return (el?.closest<HTMLElement>(climb) ?? el) || null;
};
/** A card whose title STARTS with `text` ("השבוע שלי · יום 3"), climbed to its rounded block. */
const cardStarting = (text: string): Find => () => {
  const hit = Array.from(document.querySelectorAll<HTMLElement>('p, span, h2, h3, div'))
    .filter((el) => visible(el) && (el.textContent ?? '').trim().startsWith(text) && (el.textContent ?? '').trim().length < 40);
  const el = hit[hit.length - 1] ?? null;
  return el?.closest<HTMLElement>('[class*="rounded"]') ?? el;
};
const tab = (name: string): Find => q(`nav [data-tour="tab-${name}"], nav a[href$="/${name}"]`);

/** The card around a heading: the nearest rounded block that holds it. */
const cardOf = (text: string): Find => () => {
  const h = byText(text, 'h1, h2, h3, p, span')();
  return h?.closest<HTMLElement>('[class*="rounded-card"], [class*="rounded-[2"], section') ?? h;
};

// Twelve stops, in the order a member meets the app (2026-10-20: "a better tour, with
// the photos and the other new areas"): the feed and its stories, a run, the home,
// the plan, the profile and records, then the photos properly — the last session,
// its folder, a photo full screen and a swipe to the next — run together, and the
// notifications. Each finds its element on the live page; a missing one is passed over.
const STEPS: Step[] = [
  {
    acts: [{ go: '/feed' }],
    spot: q('section.mcel'),
    needs: q('section.mcel'),
    title: 'הסטוריז של המועדון',
    body: 'למעלה בפיד: מי חוגג השבוע, הודעות מהמועדון והשבוע שלכם. עיגול צבעוני — יש משהו חדש.',
  },
  {
    acts: [{ tap: q('section.mcel .strip button') }, { wait: 700 }],
    needs: q('section.mcel'),
    title: 'ככה נפתח סטורי',
    body: 'מחליקים הצידה לבא, ולמטה כדי לסגור.',
  },
  {
    acts: [{ key: 'Escape' }, { wait: 450 }],
    spot: q('main div[role="button"][aria-label="לצפייה בריצה המלאה"]'),
    needs: q('main div[role="button"][aria-label="לצפייה בריצה המלאה"]'),
    title: 'כל ריצה של המועדון',
    body: 'נכנסת לבד מהשעון: מרחק, קצב, זמן — ולייק או תגובה בלחיצה.',
  },
  {
    acts: [{ tap: q('main div[role="button"][aria-label="לצפייה בריצה המלאה"]') }, { wait: 1300 }],
    spot: cardOf('ניתוח'),
    needs: byText('ניתוח', 'h2, h3'),
    needsMs: 6000,
    title: 'הריצה עצמה',
    body: 'גרפים אמיתיים מהשעון: קצב, דופק, פיצולים — גוררים על הגרף כדי לראות כל רגע.',
  },
  {
    acts: [{ tap: q('nav a[href="/dashboard"]') }, { wait: 1000 }],
    // The page from its greeting down: today's session, "coming?", the club today.
    spot: q('main h1'),
    spotBelow: true,
    title: 'היום שלכם',
    body: 'האימון של היום עם הקצב שלכם, ו"מגיעים?" בלחיצה אחת — המאמן רואה מי בא.',
  },
  {
    acts: [{ wait: 200 }],
    spot: () => q('[data-tour="weekStrip"]')() ?? cardStarting('השבוע שלי')(),
    needs: () => q('[data-tour="weekStrip"]')() ?? cardStarting('השבוע שלי')(),
    title: 'השבוע שלי',
    body: 'טבעת אחת לכל השבוע: כמה רצתם, ומה עוד נשאר לפי התוכנית.',
  },
  {
    acts: [{ tap: tab('program') }, { wait: 900 }],
    spot: byText('שבוע אימונים', 'button'),
    spotBelow: true,
    title: 'התוכנית השבועית',
    body: 'כל אימון של השבוע מהמאמן. לחיצה על יום פותחת את המבנה המלא — וגם שולחת אותו לשעון.',
  },
  {
    acts: [{ tap: tab('academy') }, { wait: 900 }],
    only: tab('academy'),
    title: 'האקדמיה שלכם',
    body: 'התוכנית האישית מהמאמן, שבוע אחרי שבוע, והמשוב שלכם עליה.',
  },
  {
    acts: [{ tap: tab('profile') }, { wait: 1000 }, { tap: byText('שיאים') }, { wait: 700 }],
    needs: byText('שיאים'),
    spot: () => byText('שיאים אישיים', 'section, [class*="rounded-card"], [class*="rounded-["]')(),
    title: 'השיאים שלכם',
    body: '5, 10, חצי ומרתון — מתעדכנים לבד אחרי כל ריצה, עם המקום שלכם במועדון. שברתם שיא? תדעו מיד.',
  },
  {
    acts: [{ tap: q('nav button[aria-label="עוד"]') }, { wait: 650 }],
    spot: q('[role="dialog"] a[href="/dashboard/photos"]'),
    title: 'כל השאר — ב״עוד״',
    body: 'תמונות, לרוץ ביחד, מרוצים, הטבות וחיפוש. נתחיל בתמונות:',
  },
  {
    acts: [{ tap: q('[role="dialog"] a[href="/dashboard/photos"]') }, { wait: 1300 }],
    needs: q('button[class*="h-[250px]"]'),
    spot: q('button[class*="h-[250px]"]'),
    title: 'התמונות מהאימונים',
    body: 'אחרי כל אימון — כל התמונות כאן. האימון האחרון ראשון, וכל התיקיות מתחת, לפי חודש.',
  },
  {
    acts: [{ tap: q('button[class*="h-[250px]"]') }, { wait: 1400 }],
    needs: q('.grid button[aria-label^="תמונה "]'),
    spot: () => q('.grid button[aria-label^="תמונה "]')()?.parentElement ?? null,
    title: 'תיקייה של אימון',
    body: 'כל התמונות מהאימון, בגדול. לחיצה על תמונה פותחת אותה:',
  },
  {
    acts: [{ tap: q('.grid button[aria-label^="תמונה "]') }, { wait: 1100 }, { swipe: q('[role="dialog"] [data-slide="1"]') }, { wait: 700 }],
    needs: q('[role="dialog"] [data-slide]'),
    title: 'כמו בגלריה של האייפון',
    body: 'מחליקים לתמונה הבאה, מגדילים בשתי אצבעות, וגוררים למטה כדי לסגור. "שמירה" — והיא בטלפון.',
  },
  {
    acts: [{ key: 'Escape' }, { wait: 500 }, { tap: q('nav button[aria-label="עוד"]') }, { wait: 650 }, { tap: q('[role="dialog"] a[href="/dashboard/run-together"]') }, { wait: 1200 }],
    needs: byText('לרוץ ביחד', 'h1'),
    spot: () => byText('לרוץ ביחד', 'h1')()?.parentElement ?? null,
    spotBelow: true,
    title: 'לרוץ ביחד',
    body: 'יוצאים לרוץ? מפרסמים מתי ואיפה — והדבוקה מקבלת התראה, ואולי מישהו יצטרף.',
  },
  {
    acts: [{ tap: q('header button[aria-label="התראות"], header a[aria-label="התראות"]') }, { wait: 1200 }],
    needs: byText('התראות', 'h1'),
    spot: () => byText('התראות', 'h1')()?.parentElement ?? null,
    spotBelow: true,
    title: 'מה שמחכה לכם',
    body: 'תגובות, לייקים, הודעות מהמאמן ושאלות לפני אימון — מה שמחכה לכם, למעלה.',
  },
  {
    acts: [{ tap: tab('feed') }, { wait: 700 }],
    title: 'זהו, אתם מוכנים 🎉',
    body: 'הפיד — כאן נפתחת האפליקציה. נתראה בריצה!',
  },
];

type Phase = 'off' | 'intro' | 'acting' | 'showing';
/**
 * Where the tour is, kept across a full page load: a tap that ends in one (a cold
 * route, iOS dropping the web view) used to end the tour in silence. On the way
 * back the tour picks up at that step, without repeating its taps.
 */
const RESUME_KEY = 'mc-live-tour';
const RESUME_MS = 3 * 60_000;
const saveAt = (n: number | null) => {
  try { if (n === null) sessionStorage.removeItem(RESUME_KEY); else sessionStorage.setItem(RESUME_KEY, JSON.stringify({ n, at: Date.now() })); } catch { /* private mode */ }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(find: Find, ms = 4000): Promise<HTMLElement | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const el = find();
    if (el) return el;
    await sleep(120);
  }
  return null;
}

export function LiveTour() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const [phase, setPhase] = useState<Phase>('off');
  const [i, setI] = useState(0);
  const [finger, setFinger] = useState<{ x: number; y: number; down: boolean; on: boolean }>({ x: 0, y: 0, down: false, on: false });
  const [hole, setHole] = useState<{ x: number; y: number; w: number; h: number; r: number } | null>(null);
  const spotEl = useRef<{ el: HTMLElement; below: boolean } | null>(null);
  const run = useRef(0);

  const resumeRef = useRef<number | null>(null);
  useEffect(() => {
    try {
      const r = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null') as { n: number; at: number } | null;
      if (r && Date.now() - r.at < RESUME_MS && r.n >= 0 && r.n < STEPS.length) resumeRef.current = r.n;
      else saveAt(null);
    } catch { /* nothing to resume */ }
  }, []);

  useEffect(() => {
    const start = () => { setI(0); setHole(null); setPhase('intro'); };
    window.addEventListener(LIVE_TOUR_EVENT, start);
    return () => window.removeEventListener(LIVE_TOUR_EVENT, start);
  }, []);

  // Keep the cut-out on its element while the page settles or scrolls.
  useEffect(() => {
    if (phase !== 'showing') return;
    let raf = 0;
    const tick = () => {
      const s = spotEl.current;
      if (s && s.el.isConnected) {
        const r = s.el.getBoundingClientRect();
        const bottom = s.below ? Math.max(r.bottom, window.innerHeight - 96) : r.bottom;
        const pad = 6;
        setHole((h) => {
          const n = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: bottom - r.top + pad * 2, r: s.below ? 22 : Math.min(26, parseFloat(getComputedStyle(s.el).borderTopLeftRadius) + pad || 18) };
          return h && Math.abs(h.x - n.x) < 0.5 && Math.abs(h.y - n.y) < 0.5 && Math.abs(h.w - n.w) < 0.5 && Math.abs(h.h - n.h) < 0.5 ? h : n;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const press = async (el: HTMLElement, token: number) => {
    const r = el.getBoundingClientRect();
    setFinger((f) => ({ ...f, on: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }));
    await sleep(650);
    if (run.current !== token) return;
    setFinger((f) => ({ ...f, down: true }));
    await sleep(160);
    el.click();
    await sleep(220);
    setFinger((f) => ({ ...f, down: false }));
  };

  const goTo = useCallback(async (k: number, resumed = false) => {
    const token = ++run.current;
    setPhase('acting');
    setHole(null);
    spotEl.current = null;
    for (let n = k; n < STEPS.length; n++) {
      const s = STEPS[n];
      if (s.only && !s.only()) continue;
      saveAt(n);
      // After a reload in the middle of this step its taps already happened.
      const acts = resumed && n === k ? [] : (s.acts ?? []);
      for (const a of acts) {
        if (run.current !== token) return;
        if ('wait' in a) await sleep(a.wait);
        else if ('key' in a) {
          (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: a.key, bubbles: true }));
        } else if ('swipe' in a) {
          const el = await waitFor(a.swipe, 2500);
          if (el) {
            const w = window.innerWidth, y = window.innerHeight * 0.48;
            setFinger((f) => ({ ...f, on: true, down: true, x: w * 0.78, y }));
            await sleep(380);
            setFinger((f) => ({ ...f, x: w * 0.22 }));
            el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
            await sleep(700);
            setFinger((f) => ({ ...f, down: false }));
          }
        } else if ('go' in a) {
          if (pathRef.current !== a.go) { router.push(a.go); await sleep(900); }
        } else {
          const el = await waitFor(a.tap, 3500);
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            await sleep(350);
            await press(el, token);
          }
        }
      }
      if (run.current !== token) return;
      if (s.needs && !(await waitFor(s.needs, s.needsMs ?? 2500))) continue; // nothing to show here: on to the next
      const el = s.spot ? await waitFor(s.spot, 3000) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 70 || r.bottom > window.innerHeight - 110) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); await sleep(400); }
        spotEl.current = { el, below: !!s.spotBelow };
      }
      setFinger((f) => ({ ...f, on: false }));
      setI(n);
      setPhase('showing');
      return;
    }
    saveAt(null);
    setPhase('off');
  }, [router]);

  // Picked up after a full page load, once goTo exists.
  useEffect(() => {
    const n = resumeRef.current;
    if (n === null) return;
    resumeRef.current = null;
    void goTo(n, true);
  }, [goTo]);

  const end = () => {
    run.current++;
    saveAt(null);
    setPhase('off');
    setHole(null);
    setFinger((f) => ({ ...f, on: false }));
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (pathRef.current !== '/feed') router.push('/feed');
  };

  if (phase === 'off' || typeof document === 'undefined') return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  // The card sits away from what it explains: below a spot in the top half, above one in the bottom.
  // With nothing lit (a story, a photo, full screen), at the top: the bottom is where they open.
  const cardTop = hole ? hole.y + hole.h / 2 > window.innerHeight * 0.55 : true;
  const shown = STEPS.filter((_, k) => k <= i).length;

  return createPortal(
    <div className="fixed inset-0 z-[3000]" style={{ pointerEvents: 'none' }} dir="rtl" aria-live="polite">
      {/* The dimming: a hole around the element, or a light veil over a whole-screen step. */}
      {phase === 'showing' && (
        hole ? (
          <div className="absolute transition-all duration-300 ease-out" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: hole.r, boxShadow: '0 0 0 9999px rgba(12,14,34,0.58)' }} />
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(transparent 55%, rgba(12,14,34,0.55))' }} />
        )
      )}
      {phase === 'acting' && <div className="absolute inset-0" style={{ background: 'rgba(12,14,34,0.10)' }} />}

      {/* The finger. */}
      <div
        aria-hidden
        className="absolute h-12 w-12 rounded-full transition-[left,top,transform,opacity] duration-[650ms] ease-[cubic-bezier(.4,0,.2,1)]"
        style={{
          left: finger.x - 24, top: finger.y - 24, opacity: finger.on ? 1 : 0,
          transform: `scale(${finger.down ? 0.82 : 1})`,
          background: 'rgba(255,255,255,0.92)', boxShadow: '0 6px 18px rgba(0,0,0,0.35), inset 0 0 0 2px rgba(35,32,143,0.25)',
        }}
      >
        {finger.down && <span className="absolute -inset-3 animate-ping rounded-full border-2 border-white" />}
      </div>

      {phase === 'intro' && (
        <div className="absolute inset-0 flex items-end justify-center p-4 pb-[max(env(safe-area-inset-bottom),20px)]" style={{ background: 'rgba(12,14,34,0.55)', pointerEvents: 'auto' }}>
          <div className="w-full max-w-[420px] rounded-[26px] bg-white p-5 text-start shadow-2xl">
            <p className="text-[13px] font-extrabold text-[#F0643C]">סיור של דקה</p>
            <p className="mt-1 text-[22px] font-black leading-tight text-ink-900">בואו נראה לכם את האפליקציה</p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-500">אני לוחץ ועובר בין המסכים, אתם רק מסתכלים. אפשר לעצור בכל רגע.</p>
            <button type="button" onClick={() => goTo(0)} className="mt-4 min-h-[52px] w-full rounded-full text-[17px] font-black text-white" style={{ background: 'linear-gradient(135deg,#23208F,#5B3FC4)' }}>יאללה</button>
            <button type="button" onClick={end} className="mt-1 min-h-[44px] w-full text-[15px] font-bold text-ink-500 underline underline-offset-2">אחר כך</button>
          </div>
        </div>
      )}

      {phase === 'showing' && (
        <div
          className={`absolute inset-x-3 mx-auto max-w-[440px] rounded-[24px] bg-white p-4 text-start shadow-2xl ${cardTop ? 'top-[max(env(safe-area-inset-top),14px)]' : 'bottom-[calc(max(env(safe-area-inset-bottom),10px)+76px)]'}`}
          style={{ pointerEvents: 'auto' }}
          role="dialog"
          aria-label={step.title}
        >
          <div className="flex items-center justify-between">
            <span className="flex gap-1" aria-hidden>
              {STEPS.map((_, k) => <i key={k} className={`block h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-[#23208F]' : k < i ? 'w-1.5 bg-[#9BA3FF]' : 'w-1.5 bg-[#D5D8E4]'}`} />)}
            </span>
            <button type="button" onClick={end} className="min-h-[36px] px-1 text-[13px] font-bold text-ink-400">{last ? 'סגירה' : 'דילוג'}</button>
          </div>
          <p className="mt-1 text-[18px] font-black leading-tight text-ink-900">{step.title}</p>
          <p className="mt-1 text-[14.5px] leading-relaxed text-ink-600">{step.body}</p>
          <button
            type="button"
            onClick={() => (last ? end() : goTo(i + 1))}
            className="mt-3 min-h-[48px] w-full rounded-full text-[16px] font-black text-white"
            style={{ background: 'linear-gradient(135deg,#23208F,#5B3FC4)' }}
            data-shown={shown}
          >
            {last ? 'לפיד, בואו נרוץ' : 'הבא'}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
