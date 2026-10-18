'use client';

import { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FeedAvatar } from '@/components/FeedAvatar';
import { FeedBodyText } from '@/components/FeedBodyText';
import { REACTIONS } from '@/lib/club-updates/model';
import type { ClubUpdate } from '@/lib/club-updates/server';
import { clock } from './format';

/** One update in the stream: who, when, the text, a photo, and the emoji row. */
export function UpdatePost({ update, canEdit, onReact, onMenu, highlight, fresh }: {
  update: ClubUpdate;
  canEdit: boolean;
  onReact: (emoji: string) => void;
  onMenu: () => void;
  highlight?: boolean;
  fresh?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const u = update;
  return (
    <article id={`u-${u.id}`} className={cn('cu-p', u.breaking && 'br', highlight && 'hl', fresh && 'fresh')}>
      <header className="mb-1.5 flex items-center gap-2">
        <FeedAvatar name={u.author.name} url={u.author.avatarUrl} className="h-[30px] w-[30px] text-[11px]" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-extrabold leading-tight text-ink-900">{u.author.name}</div>
          <div className="text-[10.5px] font-semibold text-ink-400">{u.author.role}</div>
        </div>
        <time className="ms-auto text-[11.5px] font-extrabold text-ink-400" dir="ltr">{clock(u.createdAt)}</time>
        {canEdit && (
          <button type="button" onClick={onMenu} aria-label="פעולות על העדכון"
            className="-me-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-400 active:bg-page">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        )}
      </header>
      <p className="whitespace-pre-line break-words text-[14.5px] leading-[1.5] text-ink-700" dir="auto">
        {u.breaking && <span className="cu-flash">מבזק</span>}
        <FeedBodyText body={u.body} />
        {u.editedAt && <span className="ms-1 text-[11px] text-ink-400">· נערך</span>}
      </p>
      {u.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={u.imageUrl} alt="" loading="lazy" className="mt-2 max-h-[320px] w-full rounded-[14px] object-cover" />
      )}
      <div className="relative mt-2.5 flex flex-wrap gap-2">
        {u.reactions.map((r) => (
          <button key={r.emoji} type="button" onClick={() => onReact(r.emoji)} aria-pressed={r.mine}
            className={cn('cu-hit flex min-h-[32px] items-center gap-1 rounded-pill px-2.5 text-[12.5px] font-bold', r.mine ? 'bg-[#E6E8FF] text-brand-600' : 'bg-page text-ink-700')}>
            <span>{r.emoji}</span><span className="tabular-nums">{r.count}</span>
          </button>
        ))}
        <button type="button" onClick={() => setPicking((v) => !v)} aria-label="להגיב" aria-expanded={picking}
          className={cn('cu-hit flex min-h-[32px] min-w-[44px] items-center justify-center rounded-pill px-2.5', picking ? 'bg-[#E6E8FF] text-brand-600' : 'bg-page text-ink-400')}>
          <Plus className="h-4 w-4" />
        </button>
        {picking && (
          <div className="cu-picker" role="menu">
            {REACTIONS.map((e) => (
              <button key={e} type="button" role="menuitem" onClick={() => { setPicking(false); onReact(e); }}>{e}</button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
