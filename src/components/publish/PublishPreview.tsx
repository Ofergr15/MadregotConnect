'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { FeedCard } from '@/components/FeedCard';
import { Circle, ClubCircle } from '@/components/feed/CelebrationStories';
import { PinnedFrame } from '@/components/feed/PinnedPosts';
import { Switch } from '@/components/ui';
import type { FeedItem } from '@/lib/feed/project';
import type { CelebrationType } from '@/lib/feed/celebration';
import { PIN_LABEL, type PinChoice } from '@/lib/publish/pin';
import { cn } from '@/lib/utils';
import '@/components/feed/celebrations.css';

// "איך זה ייראה" (mockup publish-preview-v2, Ofer 10-20): above every kind of post, what
// it will look like in each place it really reaches — drawn with the feed's own cards
// and circles fed the draft, so the preview is what goes up. Only the places the
// settings below send it to are offered; the notification only when it will be sent.

export type Place = 'feed' | 'circle' | 'push';
const PLACE_LABEL: Record<Place, string> = { feed: 'בפיד', circle: 'בעיגול', push: 'בהתראה' };

export function PreviewStage({ places, children }: { places: Place[]; children: (p: Place) => ReactNode }) {
  const [at, setAt] = useState<Place>(places[0] ?? 'feed');
  // A place switched off below (no push any more): the stage moves to one still on.
  useEffect(() => { if (!places.includes(at) && places[0]) setAt(places[0]); }, [places, at]);
  if (!places.length) return null;
  return (
    <section className="rounded-[22px] bg-gradient-to-b from-[#E9E9F0] to-[#E1E1EA] p-2.5" aria-label="איך זה ייראה">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <b className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-ink-500">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-[#34C759] shadow-[0_0_0_3px_rgba(52,199,89,0.2)]" />איך זה ייראה
        </b>
        <div className="flex gap-1" role="tablist">
          {places.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={at === p} onClick={() => setAt(p)}
              className={cn('min-h-[30px] rounded-full px-2.5 text-[12px] font-bold', at === p ? 'bg-ink-900 text-white' : 'bg-white/60 text-ink-500')}>
              {PLACE_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      {/* The cards are the feed's own; nothing in the preview is tappable. */}
      <div className="pointer-events-none select-none" aria-hidden>{children(places.includes(at) ? at : places[0])}</div>
    </section>
  );
}

/** A club post as the feed will build it (lib/feed/project.ts: author null = "Madregot"). */
export function draftItem(p: { body: string; imageUrl?: string | null; payload?: Record<string, unknown> }): FeedItem {
  return {
    id: 'draft', type: 'announcement',
    author: { athleteId: null, name: 'Madregot', avatarUrl: null, groupName: null },
    body: p.body || null,
    media: p.imageUrl ? [{ path: '', url: p.imageUrl, w: null, h: null }] : [],
    payload: p.payload ?? { message: true },
    occurredAt: new Date().toISOString(),
    likeCount: 0, commentCount: 0, likedByMe: false, likePreview: [], commentPreview: [],
    canDelete: false, activity: null,
  } as FeedItem;
}

const noop = () => {};

/** The card in the feed, in the pinned frame when it will be pinned. */
export function FeedPreview({ item, pinnedUntil }: { item: FeedItem; pinnedUntil: string | null }) {
  const card = <FeedCard item={item} commentCount={0} onComment={noop} />;
  return pinnedUntil ? <PinnedFrame until={pinnedUntil}>{card}</PinnedFrame> : card;
}

/** The Madregot circle first on "חוגגים השבוע", new, and the message it opens. */
export function ClubCirclePreview({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-2">
      <section className="mcel rounded-[22px] bg-card px-1.5 pb-3 pt-3" dir="rtl">
        <p className="mb-2 px-2.5 text-[12px] font-extrabold text-ink-400">🎉 חוגגים השבוע</p>
        <div className="strip flex gap-2 px-1.5 pt-1"><ClubCircle unseen hint={false} hand={false} onOpen={noop} /></div>
      </section>
      <div className="mcel-sheet rounded-[22px] bg-card px-6 pb-5 pt-3 text-center">
        <span className="cring brand mx-auto block h-[72px] w-[72px] rounded-full p-[3px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" className="block h-full w-full rounded-full border-[3px] border-card bg-white object-contain p-1" />
        </span>
        <h3 className="mt-3 text-[19px] font-black leading-tight text-ink-900">{title || 'הכותרת (השורה הראשונה)'}</h3>
        <p className="mt-1.5 whitespace-pre-line text-[14.5px] leading-relaxed text-ink-700">{text || 'הטקסט (מהשורה השנייה)'}</p>
      </div>
    </div>
  );
}

/** A cheer's circle — the person, in the new ring, with the occasion's emoji — and the greeting it opens. */
export function CheerCirclePreview({ name, type, text }: { name: string; type: CelebrationType; text: string }) {
  const item = draftItem({ body: text, payload: { cheerFor: 'draft' } });
  return (
    <div className="space-y-2">
      <section className="mcel rounded-[22px] bg-card px-1.5 pb-3 pt-3" dir="rtl">
        <p className="mb-2 px-2.5 text-[12px] font-extrabold text-ink-400">🎉 חוגגים השבוע</p>
        <div className="strip flex gap-2 px-1.5 pt-1">
          <Circle entry={{ item, celebration: { type, honorees: ['draft'], video: null }, honorees: name ? [{ id: 'draft', name, avatarUrl: null }] : [] }}
            seen={false} hint={false} hand={false} onOpen={noop} />
        </div>
      </section>
      <div className="rounded-[22px] bg-card px-6 pb-5 pt-4 text-center">
        <p className="text-[34px] leading-none">{type === 'birthday' ? '🎂' : type === 'race' ? '🏁' : '🏅'}</p>
        <p dir="auto" className="mt-2 whitespace-pre-line text-[16px] font-bold leading-relaxed text-ink-900">{text || 'הברכה'}</p>
      </div>
    </div>
  );
}

/** The notification on a locked phone. */
export function LockPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[18px] bg-[#1c1c2e] bg-gradient-to-b from-[#2b2b48] to-[#151522] p-3 pt-6">
      <p className="mb-3 text-center text-[30px] font-light leading-none text-white"><bdi dir="ltr">9:41</bdi></p>
      <div className="rounded-[16px] bg-white/90 px-3.5 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2 text-xs font-bold text-ink-400">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" className="h-5 w-5 rounded-[5px] bg-white object-contain" />MADREGOT<span className="ms-auto font-normal">עכשיו</span>
        </div>
        <p dir="auto" className="mt-1 text-[15px] font-bold leading-snug text-ink-900">{title || 'הכותרת'}</p>
        {body && <p dir="auto" className="line-clamp-2 text-[15px] leading-snug text-ink-700">{body}</p>}
      </div>
    </div>
  );
}

/** "נעוץ בראש הפיד" and for how long — the same block on every kind that reaches the feed. */
export function PinSetting({ on, setOn, choice, setChoice, date, setDate, choices }: {
  on: boolean; setOn: (v: boolean) => void;
  choice: PinChoice; setChoice: (c: PinChoice) => void;
  date: string; setDate: (d: string) => void;
  choices: PinChoice[];
}) {
  return (
    <div className="rounded-[18px] bg-card">
      <div className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2">
        <span className="min-w-0"><b className="block text-[15px] text-ink-900">📌 נעוץ בראש הפיד</b><small className="block text-13 text-ink-400">נשאר ראשון בפיד עד שהזמן נגמר</small></span>
        <Switch checked={on} onChange={setOn} activeColor="bg-[#1FA55B]" ariaLabel="נעוץ בראש הפיד" />
      </div>
      {on && (
        <div className="space-y-2 px-4 pb-3">
          <div className="flex flex-wrap gap-1.5">
            {choices.map((c) => (
              <button key={c} type="button" aria-pressed={choice === c} onClick={() => setChoice(c)}
                className={cn('min-h-[36px] rounded-full px-3 text-13 font-bold', choice === c ? 'bg-ink-900 text-white' : 'bg-page text-ink-600')}>
                {PIN_LABEL[c]}
              </button>
            ))}
          </div>
          {choice === 'date' && (
            <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" aria-label="עד מתי"
              className="min-h-[44px] w-full rounded-xl bg-page px-3 text-base font-bold" />
          )}
        </div>
      )}
    </div>
  );
}
