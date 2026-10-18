'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Heart, MessageCircle, Play } from 'lucide-react';
import { useApi } from '@/lib/api';
import { toggleLike, type FeedItem } from '@/lib/feed-client';
import { Sheet } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import { FeedBodyText } from '@/components/FeedBodyText';
import { cn } from '@/lib/utils';
import { CELEBRATION_TYPES, celebrationText, type Celebration } from '@/lib/feed/celebration';
import type { BirthdayStory } from '@/lib/birthday-year/server';
import { YearStory } from '@/components/birthday/YearStory';
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
const readSeen = (): string[] => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; }
};
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

function Circle({ entry, seen, onOpen }: { entry: Entry; seen: boolean; onOpen: () => void }) {
  const kind = CELEBRATION_TYPES[entry.celebration.type];
  const people = entry.honorees;
  const lead = people[0];
  const name = lead ? first(lead.name) : kind.label;
  const more = people.length > 1 ? people.length - 1 : 0;
  return (
    <button type="button" onClick={onOpen} className="flex w-[72px] shrink-0 flex-col items-center text-center active:opacity-80" aria-label={`${kind.label}: ${people.map(p => p.name).join(', ')}`}>
      <span className={cn('cring relative rounded-full p-[3px]', seen && 'seen')}>
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
  const [pop, setPop] = useState(0);
  const like = async () => {
    setLiked(v => !v); setLikes(n => n + (liked ? -1 : 1)); setPop(p => p + 1);
    try { const r = await toggleLike(entry.item.id); setLiked(r.liked); setLikes(r.likeCount); }
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
      <div className="mt-4 flex items-center justify-center gap-3">
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
  const { data } = useApi<{ today: string; entries: Entry[] }>('/api/feed/celebrations');
  const myId = useAthleteId();
  const [yearStory, setYearStory] = useState<BirthdayStory | null>(null);
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const [seen, setSeen] = useState<string[]>([]);
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

  if (entries.length === 0) return null;
  // Unseen first, like stories: what is new is what you see without scrolling.
  const order = entries.map((e, i) => ({ e, i })).sort((a, b) => Number(seen.includes(a.e.item.id)) - Number(seen.includes(b.e.item.id)));

  return (
    <section className="mcel mb-4 rounded-[26px] bg-card px-1.5 pb-3 pt-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]" dir="rtl">
      <p className="mb-2 px-2.5 text-[12px] font-extrabold text-ink-400">🎉 חוגגים היום</p>
      {/* A sideways scroller clips vertically too: pt/pb keep the ring's top and the ▶ badge inside it. */}
      <div className="strip flex gap-2 overflow-x-auto px-1.5 pb-0.5 pt-1">
        {order.map(({ e, i }) => (
          <Circle key={e.item.id} entry={e} seen={seen.includes(e.item.id)} onOpen={() => setOpen(i)} />
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
      {yearStory && <YearStory story={yearStory} onClose={() => setYearStory(null)} />}
    </section>
  );
}
