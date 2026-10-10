'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ═════════════════════════════════════════════════════════════════════════════
// THE JOINING JOURNEY'S ONE LOOK — every screen from /register to the first
// in-app welcome is drawn with these pieces, and the member mails
// (lib/email/template) use the same palette.
//
// Ofer, 2026-10-10: the journey had four design languages (dark photo, electric
// blue, the old white card, the dark install guide) and the mails a fifth. The
// academy mail is the bar he picked, so this is its "sunset on the track":
// a dusk-to-sun header with the club badge, a cream page, a 4-step tracker
// (sun = done, dusk = now), a soft "next up" card, ONE primary pill per screen,
// secondary actions at full 44px height, plural/impersonal Hebrew.
//
// Mockup: ~/.cache/madregot/journey-audit/plan.html. Phone: the screen is the
// page, the primary action sits in a bottom bar. Computer (md+): the same
// content as one centred card, never a phone column lost on an empty page.
// ═════════════════════════════════════════════════════════════════════════════

export const JOURNEY = {
  page: '#FBF1EC',
  dusk: '#23208F',
  sun: '#F0643C',
  eyebrow: '#FFD9C9',
  headerSub: '#FFE7DC',
  tag: '#C2461F',
  tagBg: '#FFEDE5',
  muted: '#A59C95',
  line: '#EDE3DC',
  body: '#3A3B45',
  soft: '#5B5F73',
  ink: '#1D1E26',
  well: '#FBF6F3',
  red: '#AD3838',
} as const;

const HERO_BG = `linear-gradient(160deg, ${JOURNEY.dusk} 0%, ${JOURNEY.sun} 100%)`;
const PRIMARY_BG = `linear-gradient(135deg, ${JOURNEY.dusk} 0%, #5B3FC4 100%)`;

/** The sunset header with the club badge. `compact` for in-flow screens (install steps). */
export function JourneyHero({ eyebrow, title, subtitle, compact = false, badge }: {
  eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; compact?: boolean;
  /** Replaces the club badge, e.g. the member's initial. */
  badge?: ReactNode;
}) {
  return (
    <header
      className={cn('text-center text-white', compact ? 'px-5 pb-4 pt-[max(16px,env(safe-area-inset-top))]' : 'px-5 pb-6 pt-[max(24px,env(safe-area-inset-top))]', 'rounded-b-[28px] md:rounded-t-[28px] md:rounded-b-none')}
      style={{ background: HERO_BG }}
    >
      {!compact && (badge ?? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/images/logo-white.png" alt="מדרגות" width={88} height={88} className="mx-auto h-[88px] w-[88px] object-contain" />
      ))}
      {eyebrow && <p className={cn('text-[13px] font-bold', compact ? '' : 'mt-3')} style={{ color: JOURNEY.eyebrow }}>{eyebrow}</p>}
      <h1 className={cn('font-black leading-tight', compact ? 'text-[21px]' : 'mt-1 text-[27px]')}>{title}</h1>
      {subtitle && <p className="mt-1 text-[15px] leading-snug" style={{ color: JOURNEY.headerSub }}>{subtitle}</p>}
    </header>
  );
}

const STEPS = ['הרשמה', 'אישור', 'התקנה', 'כניסה'] as const;

/**
 * The one progress tracker of the journey. `done` counts on the 4-step scale
 * (2 = registered + approved). `computer`: there is nothing to install on a
 * computer, so that step is not drawn (and the count shifts past it).
 */
export function JourneyTracker({ done, computer = false }: { done: number; computer?: boolean }) {
  const steps = computer ? STEPS.filter((s) => s !== 'התקנה') : [...STEPS];
  const at = computer && done > 2 ? done - 1 : done;
  return (
    <ol className="flex items-start px-1" aria-label={`שלב ${Math.min(at + 1, steps.length)} מתוך ${steps.length}`}>
      {steps.map((label, i) => {
        const isDone = i < at, isAt = i === at;
        return (
          <li key={label} className="flex flex-1 items-start last:flex-none">
            <div className="flex w-14 flex-col items-center gap-1.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 text-[14px] font-black"
                style={isDone ? { background: JOURNEY.sun, borderColor: JOURNEY.sun, color: '#fff' }
                  : isAt ? { background: '#fff', borderColor: JOURNEY.dusk, color: JOURNEY.dusk }
                    : { background: '#fff', borderColor: JOURNEY.line, color: JOURNEY.muted }}
              >{isDone ? '✓' : i + 1}</span>
              <span className="text-[13px] font-bold" style={{ color: isDone ? JOURNEY.sun : isAt ? JOURNEY.dusk : JOURNEY.muted }}>{label}</span>
            </div>
            {i < steps.length - 1 && <span aria-hidden className="mt-4 h-0.5 flex-1" style={{ background: i < at ? JOURNEY.sun : JOURNEY.line }} />}
          </li>
        );
      })}
    </ol>
  );
}

/** The soft "next up" card: a small label, one bold line, one quiet line. */
export function NextCard({ label, title, children }: { label: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-[20px] px-4 py-4 text-center" style={{ background: JOURNEY.tagBg }}>
      <p className="text-[12px] font-extrabold tracking-wide" style={{ color: JOURNEY.tag }}>{label}</p>
      <p className="mt-1 text-[18px] font-black" style={{ color: JOURNEY.ink }}>{title}</p>
      {children && <div className="mt-1 text-[14px] leading-relaxed" style={{ color: JOURNEY.soft }}>{children}</div>}
    </div>
  );
}

/** A white card on the cream page. */
export function JourneyCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-[20px] bg-white p-4', className)}>{children}</div>;
}

/** One row of a list inside a card: an emoji tile, a bold line, a quiet line. */
export function JourneyRow({ icon, title, sub, end }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-lg" style={{ background: JOURNEY.tagBg }} aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold" style={{ color: JOURNEY.ink }}>{title}</span>
        {sub && <span className="block text-[13.5px] leading-snug" style={{ color: JOURNEY.soft }}>{sub}</span>}
      </span>
      {end}
    </div>
  );
}

type BtnProps = { children: ReactNode; onClick?: () => void; href?: string; disabled?: boolean; type?: 'button' | 'submit'; className?: string };

/** The ONE primary action of a screen. */
export function PrimaryButton({ children, onClick, href, disabled, type = 'button', className }: BtnProps) {
  const cls = cn('flex min-h-[54px] w-full items-center justify-center rounded-full px-6 text-[17px] font-black text-white shadow-[0_10px_24px_rgba(35,32,143,0.28)] active:opacity-90 disabled:opacity-60', className);
  const style = { background: disabled ? JOURNEY.muted : PRIMARY_BG };
  if (href) return <a href={href} className={cls} style={style}>{children}</a>;
  return <button type={type} onClick={onClick} disabled={disabled} className={cls} style={style}>{children}</button>;
}

/** A secondary action: full-width, 44px, quiet. `outline` for a second real choice. */
export function SecondaryButton({ children, onClick, href, disabled, type = 'button', className, outline = false }: BtnProps & { outline?: boolean }) {
  const cls = cn('flex min-h-[46px] w-full items-center justify-center rounded-full px-5 text-[15px] font-bold disabled:opacity-60', outline ? 'border bg-white' : 'underline underline-offset-2', className);
  const style = { color: outline ? JOURNEY.ink : JOURNEY.soft, borderColor: JOURNEY.line };
  if (href) return <a href={href} className={cls} style={style}>{children}</a>;
  return <button type={type} onClick={onClick} disabled={disabled} className={cls} style={style}>{children}</button>;
}

/**
 * The screen. Phone: cream page, hero, content, and the actions in a bottom bar
 * that stays in reach. Computer (md+): one centred card, hero on top, actions at
 * its foot — the same content, laid out for a big screen.
 */
export function JourneyScreen({ hero, children, actions, testId }: { hero: ReactNode; children?: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <div className="min-h-[100dvh] md:flex md:items-center md:justify-center md:p-8" style={{ background: JOURNEY.page }} dir="rtl" data-testid={testId}>
      <div className="flex min-h-[100dvh] flex-col md:min-h-0 md:w-full md:max-w-[520px] md:overflow-hidden md:rounded-[28px] md:bg-white md:shadow-[0_18px_50px_rgba(0,0,0,0.08)]">
        {hero}
        <main className="flex flex-1 flex-col gap-3 px-4 pt-4 md:px-7 md:pt-6" style={{ color: JOURNEY.body }}>{children}</main>
        {actions && (
          <div className="sticky bottom-0 z-10 flex flex-col gap-1 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 md:static md:px-7 md:pb-7 md:![background:#fff]" style={{ background: `linear-gradient(transparent, ${JOURNEY.page} 28%)` }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
