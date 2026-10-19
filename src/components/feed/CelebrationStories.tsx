'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Heart, MessageCircle, Play } from 'lucide-react';
import { apiFetcher, useApi } from '@/lib/api';
import { preload } from 'swr';
import { toggleLike, type FeedItem } from '@/lib/feed-client';
import type { FeedLiker } from '@/lib/feed/project';
import { FeedLikesSheet } from '@/components/FeedLikesSheet';
import { Sheet } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import { FeedBodyText } from '@/components/FeedBodyText';
import { cn } from '@/lib/utils';
import { CELEBRATION_TYPES, celebrationText, type Celebration } from '@/lib/feed/celebration';
import type { BirthdayStory } from '@/lib/birthday-year/server';
import { YearStory } from '@/components/birthday/YearStory';
import type { WeekStory as WeekStoryData } from '@/lib/week-story/server';
import { WeekStory } from '@/components/week-story/WeekStory';
import { useSearchParams } from 'next/navigation';
import { useAthleteId } from '@/lib/use-athlete-id';
import './celebrations.css';

// ═════════════════════════════════════════════════════════════════════════════
// "חוגגים היום" — the row of circles at the top of the feed (Ofer, 2026-10-18:
// direction B of ~/.cache/madregot/celebrations/top-options.html, "a better-made
// version"). Each circle is the person's real photo in a coloured ring with the
// occasion's emoji on it; ▶ on the ring means there is a video. A circle once
// opened greys out, like a story. Tapping opens a sheet: a short confetti burst,
// the greeting, the video, the like and the comments — and a swipe to the next.
// Nothing renders on a day with nothing to celebrate.
// ═════════════════════════════════════════════════════════════════════════════

interface Entry {
  item: FeedItem;
  celebration: Celebration;
  honorees: Array<{ id: string; name: string; avatarUrl: string | null }>;
}

const SEEN_KEY = 'mc:celebrations-seen';
/**
 * Set on the first tap on any circle (Ofer, 10-18: "people have to understand you tap
 * the circles, it is new"). Until then an unopened circle breathes and the first one
 * has a small hand on it (mockup celebration-hint, option B); after it, never again.
 */
const TAPPED_KEY = 'mc:celebrations-tapped';
const readSeen = (): string[] => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; }
};
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

function Circle({ entry, seen, hint, hand, onOpen }: { entry: Entry; seen: boolean; hint: boolean; hand: boolean; onOpen: () => void }) {
  const kind = CELEBRATION_TYPES[entry.celebration.type];
  const people = entry.honorees;
  const lead = people[0];
  const name = lead ? first(lead.name) : kind.label;
  const more = people.length > 1 ? people.length - 1 : 0;
  return (
    <button type="button" onClick={onOpen} className="flex w-[72px] shrink-0 flex-col items-center text-center active:opacity-80" aria-label={`${kind.label}: ${people.map(p => p.name).join(', ')}`}>
      <span className={cn('cring relative rounded-full p-[3px]', seen && 'seen', hint && 'breathe')}>
        {hand && <span aria-hidden className="chand">👆</span>}
        <span className="block rounded-full border-[3px] border-card">
          {lead
            ? <FeedAvatar name={lead.name} url={lead.avatarUrl} className="h-[54px] w-[54px] text-[15px]" />
            : <span className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-page text-2xl">{kind.emoji}</span>}
        </span>
        <span className="absolute -bottom-0.5 -end-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-card text-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.2)]">{kind.emoji}</span>
        {entry.celebration.video && (
          <span className="absolute -top-0.5 -start-0.5 flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 border-card bg-ink-900 text-white">
            <Play className="h-2.5 w-2.5 fill-current" />
          </span>
        )}
      </span>
      <span className="mt-1.5 w-full truncate text-[12px] font-bold leading-tight text-ink-900">{name}{more > 0 && <> <bdi dir="ltr">+{more}</bdi></>}</span>
      <span className="w-full truncate text-[10.5px] leading-tight text-ink-400">{kind.label}</span>
    </button>
  );
}

interface ClubMessage { id: string; title: string; text: string }

/** The Madregot circle, first on the row: the club's message (lib/feed/club-stories.ts). */
function ClubCircle({ unseen, hint, hand, onOpen }: { unseen: boolean; hint: boolean; hand: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-[72px] shrink-0 flex-col items-center text-center active:opacity-80" aria-label="הודעה ממדרגות">
      <span className={cn('cring brand relative rounded-full p-[3px]', !unseen && 'seen', hint && 'breathe')}>
        {hand && <span aria-hidden className="chand">👆</span>}
        <span className="block rounded-full border-[3px] border-card bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" className="h-[54px] w-[54px] rounded-full object-contain p-1" />
        </span>
        {unseen && <span className="absolute end-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-card bg-[#FF3B30]" />}
      </span>
      <span className="mt-1.5 w-full truncate text-[12px] font-bold leading-tight text-ink-900">מדרגות</span>
      <span className="w-full truncate text-[10.5px] leading-tight text-ink-400">הודעה</span>
    </button>
  );
}

/**
 * "השבוע שלך" — the member's own blue circle, first on the row from Saturday 12:00 to
 * Sunday 20:00 (lib/week-story). Greyed once opened, like the others.
 */
function WeekCircle({ km, seen, onOpen }: { km: number; seen: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-[72px] shrink-0 flex-col items-center text-center active:opacity-80" aria-label="השבוע שלך">
      <span className={cn('cring week relative rounded-full p-[3px]', seen && 'seen', !seen && 'breathe')}>
        <span className="block rounded-full border-[3px] border-card">
          <span className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-gradient-to-b from-[#1525FF] to-[#0a1080] text-2xl">🏃</span>
        </span>
      </span>
      <span className="mt-1.5 w-full truncate text-[12px] font-bold leading-tight text-ink-900">השבוע שלך</span>
      <span className="w-full truncate text-[10.5px] leading-tight text-ink-400"><bdi>{km.toFixed(1)}</bdi> ק״מ</span>
    </button>
  );
}

const CONFETTI = ['#F7797D', '#FFC75F', '#8E7CFF', '#5BC0EB', '#45C49C'];

function Slide({ entry, active, onComment, myId, onYear }: {
  entry: Entry;
  active: boolean;
  onComment: (i: FeedItem) => void;
  myId: string | null;
  /** Opens a birthday person's "השנה שלך" (lib/birthday-year) — every member sees it (Ofer, 2026-10-18). */
  onYear: (story: BirthdayStory) => void;
}) {
  const kind = CELEBRATION_TYPES[entry.celebration.type];
  const [liked, setLiked] = useState(entry.item.likedByMe);
  const [likes, setLikes] = useState(entry.item.likeCount);
  // Who liked, like Instagram (mockup celebration-likers): three faces and a name or two,
  // and a tap opens everyone (the feed's own FeedLikesSheet).
  const [likers, setLikers] = useState<FeedLiker[]>(entry.item.likePreview ?? []);
  const [showLikers, setShowLikers] = useState(false);
  const [pop, setPop] = useState(0);
  const like = async () => {
    setLiked(v => !v); setLikes(n => n + (liked ? -1 : 1)); setPop(p => p + 1);
    try { const r = await toggleLike(entry.item.id); setLiked(r.liked); setLikes(r.likeCount); if (r.likePreview) setLikers(r.likePreview); }
    catch { setLiked(entry.item.likedByMe); setLikes(entry.item.likeCount); }
  };
  const people = entry.honorees;
  // The year story of the birthday person, when there is one to show: theirs for the week
  // of the birthday while sending is on, and the admin's preview any time.
  const yearOf = entry.celebration.type === 'birthday' ? entry.celebration.honorees[0] ?? null : null;
  const { data: year } = useApi<{ story: BirthdayStory | null }>(yearOf ? `/api/birthday-year?athleteId=${encodeURIComponent(yearOf)}` : null);
  const story = year?.story ?? null;
  return (
    <div className="slide relative w-full shrink-0 px-5 pb-2 pt-1">
      {active && (
        <div className="confetti" aria-hidden>
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 53) % 100}%`, background: CONFETTI[i % CONFETTI.length], animationDelay: `${(i % 6) * 70}ms` }} />
          ))}
        </div>
      )}
      <div className="flex justify-center">
        <div className="relative flex -space-x-3 rtl:space-x-reverse">
          {(people.length ? people.slice(0, 3) : [null]).map((p, i) => (
            <span key={p?.id ?? i} className="rounded-full border-4 border-card">
              {p
                ? <FeedAvatar name={p.name} url={p.avatarUrl} className="h-[76px] w-[76px] text-[22px]" />
                : <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-page text-4xl">{kind.emoji}</span>}
            </span>
          ))}
          <span className="absolute -bottom-1 end-0 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-card text-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.2)]">{kind.emoji}</span>
        </div>
      </div>
      <p className="mt-3 text-center text-[20px] font-black leading-snug text-ink-900">
        <FeedBodyText body={celebrationText(entry.item.body, entry.celebration.type)} />
      </p>
      {entry.celebration.video && (
        <a
          href={entry.celebration.video}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex min-h-[50px] items-center justify-center gap-2.5 rounded-pill text-[15px] font-extrabold text-white active:opacity-85"
          style={{ background: kind.accent }}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white" style={{ color: kind.accent }}>
            <Play className="h-3 w-3 fill-current" />
          </span>
          לצפייה בסרטון
        </a>
      )}
      {story && (
        <button
          type="button"
          onClick={() => onYear(story)}
          className="mt-3 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-pill bg-gradient-to-l from-[#1525FF] to-[#0a1080] text-[15px] font-extrabold text-white active:opacity-85"
        >
          🎬 {story.athleteId === myId ? 'השנה שלך בריצה' : `השנה של ${story.name} בריצה`}
        </button>
      )}
      {likes > 0 && likers.length > 0 && (
        <button type="button" onClick={() => setShowLikers(true)} className="mx-auto mt-4 flex min-h-[40px] items-center justify-center gap-2 text-[14px] text-ink-700">
          <span className="flex" dir="ltr">
            {likers.slice(0, 3).map((l, i) => (
              <span key={l.athleteId} className={cn('rounded-full border-2 border-card', i > 0 && '-ms-2.5')}>
                <FeedAvatar name={l.name} url={l.avatarUrl} className="h-7 w-7 text-[10px]" />
              </span>
            ))}
          </span>
          <span>
            {likers.slice(0, 2).map((l, i) => <span key={l.athleteId}>{i > 0 && ', '}<b className="font-extrabold">{first(l.name)}</b></span>)}
            {likes > Math.min(2, likers.length) ? <> ועוד <b className="font-extrabold tabular-nums">{likes - Math.min(2, likers.length)}</b> אהבו</> : likes > 1 ? ' אהבו' : ' ❤️'}
          </span>
        </button>
      )}
      {showLikers && <FeedLikesSheet itemId={entry.item.id} likeCount={likes} seed={likers} onClose={() => setShowLikers(false)} />}
      <div className="mt-3 flex items-center justify-center gap-3">
        <button type="button" onClick={like} aria-pressed={liked}
          className={cn('flex min-h-[44px] items-center gap-2 rounded-pill px-4 text-sm font-bold', liked ? 'bg-accent-red/10 text-accent-red' : 'bg-page text-ink-700')}>
          <Heart key={pop} className={cn('h-[18px] w-[18px]', liked && 'fill-current', pop > 0 && 'pop')} />
          <span className="tabular-nums">{likes > 0 ? likes : 'מזל טוב'}</span>
        </button>
        <button type="button" onClick={() => onComment(entry.item)}
          className="flex min-h-[44px] items-center gap-2 rounded-pill bg-page px-4 text-sm font-bold text-ink-700">
          <MessageCircle className="h-[18px] w-[18px]" />
          {entry.item.commentCount > 0 ? <span className="tabular-nums">{entry.item.commentCount}</span> : 'לכתוב ברכה'}
        </button>
      </div>
    </div>
  );
}

export function CelebrationStories({ onComment }: { onComment: (item: FeedItem) => void }) {
  const { data } = useApi<{ today: string; entries: Entry[]; club?: ClubMessage[] }>('/api/feed/celebrations');
  const club = useMemo(() => data?.club ?? [], [data]);
  const [clubOpen, setClubOpen] = useState(false);
  const myId = useAthleteId();
  // Each birthday's year is fetched as soon as the strip is there, not when its circle is
  // opened: the slide's "השנה של…" button then shows with the greeting, not seconds after.
  useEffect(() => {
    for (const e of data?.entries ?? []) {
      const id = e.celebration.type === 'birthday' ? e.celebration.honorees[0] : null;
      if (id) preload(`/api/birthday-year?athleteId=${encodeURIComponent(id)}`, apiFetcher);
    }
  }, [data]);
  const [yearStory, setYearStory] = useState<BirthdayStory | null>(null);
  // The week story: asked for only while its window may be open (the server decides).
  const { data: wk } = useApi<{ story: WeekStoryData | null }>('/api/week-story');
  const week = wk?.story ?? null;
  const weekKey = week ? `week:${week.window.weekEnd}` : null;
  const [weekOpen, setWeekOpen] = useState(false);
  const params = useSearchParams();
  const fromPush = params?.get('weekStory') === '1';
  useEffect(() => { if (fromPush && week) setWeekOpen(true); }, [fromPush, week]);
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const [seen, setSeen] = useState<string[]>([]);
  // True until read, so a returning member never sees the hint flash on load.
  const [tapped, setTapped] = useState(true);
  useEffect(() => { try { setTapped(localStorage.getItem(TAPPED_KEY) === '1'); } catch { /* private mode: no hint */ } }, []);
  const markTapped = useCallback(() => {
    setTapped(true);
    try { localStorage.setItem(TAPPED_KEY, '1'); } catch { /* private mode */ }
  }, []);
  const [open, setOpen] = useState<number | null>(null);
  const [at, setAt] = useState(0);
  const slidesRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setSeen(readSeen()); }, []);

  const markSeen = useCallback((id: string) => {
    setSeen(prev => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id].slice(-100);
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  // Opening on a circle scrolls the sheet to its slide; a swipe moves `at`.
  useEffect(() => {
    if (open == null) return;
    setAt(open);
    markSeen(entries[open].item.id);
    // The sheet mounts and lays out over a few frames, so one frame after `open` the
    // row may not exist or have no width yet, and the scroll did nothing: a tap on
    // the second circle opened the first (lab, 10-18). Try each frame until it lands.
    let frames = 0;
    let raf = 0;
    const land = () => {
      const el = slidesRef.current;
      if (el && el.clientWidth > 0) {
        // In a right-to-left row scrollLeft runs from 0 towards negative numbers.
        const sign = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
        const left = sign * open * el.clientWidth;
        el.scrollTo({ left, behavior: 'instant' as ScrollBehavior });
        if (Math.abs(el.scrollLeft - left) < 2 || open === 0) return;
      }
      if (++frames < 30) raf = requestAnimationFrame(land);
    };
    raf = requestAnimationFrame(land);
    return () => cancelAnimationFrame(raf);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = slidesRef.current;
    if (!el) return;
    const i = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    if (i !== at && entries[i]) { setAt(i); markSeen(entries[i].item.id); }
  };

  if (entries.length === 0 && club.length === 0 && !week) return null;
  const hinting = !tapped;
  const clubUnseen = club.some((m) => !seen.includes(`club:${m.id}`));
  // Unseen first, like stories: what is new is what you see without scrolling.
  const order = entries.map((e, i) => ({ e, i })).sort((a, b) => Number(seen.includes(a.e.item.id)) - Number(seen.includes(b.e.item.id)));

  return (
    <section className="mcel mb-4 rounded-[26px] bg-card px-1.5 pb-3 pt-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]" dir="rtl">
      <p className="mb-2 px-2.5 text-[12px] font-extrabold text-ink-400">{entries.length || club.length ? '🎉 חוגגים היום' : '🏃 השבוע שלך מוכן'}</p>
      {/* A sideways scroller clips vertically too: pt/pb keep the ring's top and the ▶ badge inside it. */}
      <div className="strip flex gap-2 overflow-x-auto px-1.5 pb-0.5 pt-2">
        {week && weekKey && (
          <WeekCircle km={week.numbers.km} seen={seen.includes(weekKey)}
            onOpen={() => { setWeekOpen(true); markTapped(); markSeen(weekKey); }} />
        )}
        {club.length > 0 && (
          <ClubCircle unseen={clubUnseen} hint={hinting && clubUnseen} hand={hinting}
            onOpen={() => { setClubOpen(true); markTapped(); club.forEach((m) => markSeen(`club:${m.id}`)); }} />
        )}
        {order.map(({ e, i }, k) => (
          <Circle
            key={e.item.id}
            entry={e}
            seen={seen.includes(e.item.id)}
            hint={hinting && !seen.includes(e.item.id)}
            hand={hinting && k === 0 && club.length === 0}
            onOpen={() => { setOpen(i); markTapped(); }}
          />
        ))}
      </div>

      <Sheet open={open != null} onOpenChange={(o) => { if (!o) setOpen(null); }} className="mcel-sheet">
        <div className="mcel-sheet" dir="rtl">
          <div ref={slidesRef} onScroll={onScroll} className="slides flex overflow-x-auto">
            {entries.map((e, i) => (
              <Slide key={e.item.id} entry={e} active={i === at && open != null}
                onComment={(item) => { setOpen(null); onComment(item); }}
                myId={myId}
                onYear={(story) => { setOpen(null); setYearStory(story); }} />
            ))}
          </div>
          {entries.length > 1 && (
            <div className="flex justify-center gap-1.5 pb-4 pt-2" aria-hidden>
              {entries.map((e, i) => (
                <span key={e.item.id} className={cn('h-1.5 rounded-full transition-all', i === at ? 'w-5 bg-ink-900' : 'w-1.5 bg-ink-300')} />
              ))}
            </div>
          )}
          {entries.length === 1 && <div className="pb-4" />}
        </div>
      </Sheet>
      <Sheet open={clubOpen} onOpenChange={setClubOpen} className="mcel-sheet">
        <div className="mcel-sheet" dir="rtl">
          <div className="slides flex overflow-x-auto">
            {club.map((m) => (
              <div key={m.id} className="slide w-full shrink-0 px-6 pb-2 pt-3 text-center">
                <span className="cring brand mx-auto block h-[84px] w-[84px] rounded-full p-[3px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/logo.png" alt="" className="block h-full w-full rounded-full border-[3px] border-card bg-white object-contain p-1" />
                </span>
                <h3 className="mt-3 text-[20px] font-black leading-tight text-ink-900">{m.title}</h3>
                {m.text && <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-ink-700">{m.text}</p>}
                <button type="button" onClick={() => setClubOpen(false)} className="mt-5 min-h-[48px] w-full rounded-2xl bg-brand-600 text-base font-extrabold text-white">סגירה</button>
              </div>
            ))}
          </div>
          {club.length > 1 && (
            <div className="flex justify-center gap-1.5 pb-4 pt-2" aria-hidden>
              {club.map((m) => <span key={m.id} className="h-1.5 w-1.5 rounded-full bg-ink-300" />)}
            </div>
          )}
          {club.length === 1 && <div className="pb-4" />}
        </div>
      </Sheet>
      {yearStory && <YearStory story={yearStory} onClose={() => setYearStory(null)} />}
      {weekOpen && week && <WeekStory story={week} onClose={() => { setWeekOpen(false); if (weekKey) markSeen(weekKey); }} />}
    </section>
  );
}
