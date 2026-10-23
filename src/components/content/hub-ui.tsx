'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { BarChart3, Bell, Camera, Check, ChevronLeft, CircleDot, Flag, Heart, Image as ImageIcon, Megaphone, MessageCircle, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useContentLevels } from '@/components/content/use-hub';
import { CONTENT_TYPES, resultChips, type ContentType, type PublishedPost, type ResultChip } from '@/lib/content/hub';

// ═════════════════════════════════════════════════════════════════════════════
// The Content hub's pieces (mockup content-v4): a kind's icon tile, its home block,
// the "מחכה לך" inset in the kind's colour, a type page's header, section headers
// with the kind's dot, and the result chips a published row carries. The colour of
// a kind comes from CONTENT_TYPES and nowhere else, so a kind reads the same on
// every screen.
// ═════════════════════════════════════════════════════════════════════════════

const ICON: Record<ContentType, typeof Camera> = { share: Share2, photos: Camera, messages: Megaphone, surveys: BarChart3, cheers: Flag, circle: CircleDot };

/** The kind's colours as CSS variables, so children can say var(--c) etc. */
export function typeVars(type: ContentType): CSSProperties {
  const m = CONTENT_TYPES[type];
  return { '--c': m.color, '--c2': m.wash, '--ci': m.ink } as CSSProperties;
}

export function TypeIcon({ type, size = 34 }: { type: ContentType; size?: number }) {
  const I = ICON[type];
  return (
    <span aria-hidden className="grid shrink-0 place-items-center text-white" style={{ width: size, height: size, borderRadius: size * 0.27, background: CONTENT_TYPES[type].color }}>
      <I style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={2.2} />
    </span>
  );
}

/** A kind's block on the hub's home: header (opens the kind's page) and whatever it holds. */
export function TypeBlock({ type, children }: { type: ContentType; children?: ReactNode }) {
  const m = CONTENT_TYPES[type];
  return (
    <section style={typeVars(type)} className="overflow-hidden rounded-[18px] bg-card">
      <Link href={m.href} className="flex min-h-[56px] items-center gap-[11px] px-3.5 pb-2.5 pt-3 active:opacity-70">
        <TypeIcon type={type} />
        <b className="flex-1 text-[17px] font-bold tracking-[-0.2px] text-ink-900">{m.label}</b>
        <ChevronLeft className="h-5 w-5 text-[#c4c4c9]" />
      </Link>
      {children}
    </section>
  );
}

/** "מחכה לך" inside a block: in the kind's wash, one action. */
export function WaitRow({ kicker, title, thumb, action, href, onAction, busy }: {
  kicker: string; title: string; thumb?: string | null; action: string; href?: string; onAction?: () => void; busy?: boolean;
}) {
  const btn = 'min-h-[36px] shrink-0 rounded-full px-[13px] text-[13px] font-bold text-white disabled:opacity-50';
  return (
    <div className="mx-2.5 mb-2.5 flex items-center gap-2.5 rounded-[13px] py-[9px] pe-[9px] ps-2.5" style={{ background: 'var(--c2)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {thumb && <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-[34px] w-[34px] shrink-0 rounded-[8px] object-cover" />}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-extrabold tracking-[0.2px]" style={{ color: 'var(--ci)' }}>{kicker}</span>
        <span dir="auto" className="mt-px block truncate text-[14px] font-semibold text-ink-900">{title}</span>
      </span>
      {href
        ? <Link href={href} className={cn(btn, 'inline-flex items-center')} style={{ background: 'var(--c)' }}>{action}</Link>
        : <button type="button" onClick={onAction} disabled={busy} className={btn} style={{ background: 'var(--c)' }}>{busy ? '…' : action}</button>}
    </div>
  );
}

/** The block's last line: the newest post (or what is on air) with ITS numbers. */
export function LastLine({ label, title, chips, href, first }: { label: string; title: string; chips?: ResultChip[]; href?: string; first?: boolean }) {
  const inner = (
    <>
      <span className="min-w-[46px] text-12 font-semibold text-ink-400">{label}</span>
      <span dir="auto" className="min-w-0 flex-1 truncate text-[13.5px] text-ink-700">{title}</span>
      {chips && <Chips chips={chips} plain />}
    </>
  );
  const cls = cn('flex min-h-[44px] items-center gap-2.5 px-3.5 pb-3 pt-2', !first && 'border-t-[0.5px] border-black/[0.08]');
  return href ? <Link href={href} className={cn(cls, 'active:bg-page')}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

const CHIP_ICON: Record<ResultChip['key'], ReactNode> = {
  likes: <Heart className="h-3 w-3 fill-[#e0306e] text-[#e0306e]" />,
  delivered: <Bell className="h-3 w-3" strokeWidth={2.4} />,
  answers: <Check className="h-3 w-3" strokeWidth={2.8} />,
  comments: <MessageCircle className="h-3 w-3" strokeWidth={2.4} />,
  photos: <ImageIcon className="h-3 w-3" strokeWidth={2.4} />,
};

export function Chips({ chips, plain }: { chips: ResultChip[]; plain?: boolean }) {
  return (
    <span className={cn('flex shrink-0 flex-wrap items-center', plain ? 'gap-2' : 'gap-1.5')}>
      {chips.map((c) => (
        <span key={c.key} className={cn('inline-flex items-center gap-1 text-12 font-bold text-ink-700', !plain && 'rounded-[8px] bg-page px-[7px] py-[3px]')}>
          {CHIP_ICON[c.key]}<bdi dir="ltr">{c.text}</bdi>
        </span>
      ))}
    </span>
  );
}

/** A kind's page: back to the hub, the big icon and title, and its one "＋". */
export function TypePage({ type, action, children }: { type: ContentType; action?: ReactNode; children: ReactNode }) {
  const m = CONTENT_TYPES[type];
  // A part this account was not given (הרשאות): its page says so, instead of an empty shell.
  const { levels } = useContentLevels();
  const level = levels ? levels[type] ?? 0 : 3;
  if (level < 1) children = <p className="mt-3 rounded-[14px] bg-card px-3.5 py-3.5 text-13 text-ink-500">החלק הזה בתוכן לא פתוח לך. מי שמנהל את ההרשאות יכול לפתוח אותו.</p>;
  // The page's "＋": publishers, and those who publish for approval (not photos — no draft there).
  if (level < (type === 'photos' ? 3 : 2)) action = null;
  return (
    <div style={typeVars(type)} className="space-y-0 pb-8" dir="rtl">
      <div className="flex h-11 items-center justify-between">
        <Link href="/dashboard/content" className="inline-flex min-h-[44px] items-center gap-0.5 text-[17px] text-[#007aff]">‹ תוכן</Link>
        {action}
      </div>
      <div className="flex items-center gap-3 pb-1.5">
        <TypeIcon type={type} size={46} />
        <h1 className="flex-1 text-[30px] font-extrabold tracking-[-0.4px] text-ink-900">{m.label}</h1>
      </div>
      {children}
    </div>
  );
}

/** The kind's "＋" (top of its page): a link or a button, in the kind's colour. */
export function PlusButton({ label, href, onClick }: { label: string; href?: string; onClick?: () => void }) {
  const cls = 'inline-flex min-h-[38px] items-center rounded-full px-3.5 text-[14px] font-bold text-white';
  return href
    ? <Link href={href} className={cls} style={{ background: 'var(--c)' }}>＋ {label}</Link>
    : <button type="button" onClick={onClick} className={cls} style={{ background: 'var(--c)' }}>＋ {label}</button>;
}

/** A section header: the kind's dot for the live parts, grey for the past. */
export function SectionHead({ children, gray, trailing }: { children: ReactNode; gray?: boolean; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-[7px] px-1 pb-[7px] pt-4 text-13 font-bold text-ink-400">
      {!gray && <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--c)' }} />}
      <span className="flex-1">{children}</span>
      {trailing}
    </div>
  );
}

export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-hidden rounded-[14px] bg-card [&>*+*]:border-t-[0.5px] [&>*+*]:border-black/[0.08]', className)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3.5 py-3.5 text-13 text-ink-400">{children}</p>;
}

/** The day tile: 22 / ה׳. `up` is a day still to come, in the kind's wash. */
export function DateTile({ date, up }: { date: string; up?: boolean }) {
  const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const d = new Date(`${date}T12:00:00Z`);
  return (
    <span className="flex h-11 w-10 shrink-0 flex-col items-center justify-center rounded-[10px]" style={{ background: up ? 'var(--c2)' : '#f2f2f7', opacity: up ? 1 : 0.8 }}>
      <b className="text-[16px] leading-none" style={{ color: up ? 'var(--ci)' : undefined }}>{d.getUTCDate()}</b>
      <small className="mt-0.5 text-[10px] font-bold text-ink-400">{DOW[d.getUTCDay()]}</small>
    </span>
  );
}

/** A published post's row: what it was, when, and its own numbers. Opens its results. */
export function PublishedRow({ post, members }: { post: PublishedPost; members: number }) {
  return (
    <Link href={`/dashboard/content/post/${post.id}`} className="flex min-h-[64px] items-center gap-3 px-3.5 py-2.5 active:bg-page">
      {post.thumb
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={post.thumb} alt="" referrerPolicy="no-referrer" className="h-[52px] w-[52px] shrink-0 rounded-[11px] object-cover" />
        : <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-page text-lg">{post.emoji}</span>}
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-[15px] font-semibold tracking-[-0.1px] text-ink-900">{post.text || '—'}</span>
        <span className="mt-1 flex items-center gap-1.5">
          <span className="text-12 text-ink-400">{postedLabel(post.at)}</span>
          <Chips chips={resultChips(post, members)} />
        </span>
      </span>
      <ChevronLeft className="h-5 w-5 shrink-0 text-[#c4c4c9]" />
    </Link>
  );
}

/** "20.10" — when a post went up, on the Israel calendar. */
export function postedLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
}

/** An iOS switch, in green. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange}
      className={cn('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-50', on ? 'bg-[#34c759]' : 'bg-[#e3e3e8]')}>
      <span className={cn('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-all', on ? 'left-[22px]' : 'left-[2px]')} />
    </button>
  );
}
