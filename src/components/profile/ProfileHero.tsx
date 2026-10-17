'use client';

import type { ReactNode } from 'react';

/**
 * The top of a profile — yours and a teammate's are the same shape (Ofer,
 * 2026-10-17, mockups/profile-hub/v2-real-app.html): a band in the club's colours,
 * the photo over its edge, the name with the pack / band / coach under the band,
 * and one card with the four numbers and the one action.
 *
 * Compact on purpose: the profile opens on the athlete's activity, and the first
 * card of it has to be on the first screen of a phone.
 *
 * Only the frame lives here. What the photo does (enlarge, upload) and what the
 * action is (edit, follow) belong to the page that knows whose profile it is, so
 * both come in as nodes.
 */
export function ProfileHero({ photo, name, nameAside, chips, counts, actions }: {
  /** 88px circle — the page decides whether it opens or uploads. */
  photo: ReactNode;
  name: string;
  /** Beside the name, e.g. the core-runner mark. */
  nameAside?: ReactNode;
  chips?: ReactNode;
  counts: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="relative -mx-4 -mt-5 sm:-mx-6">
      <div aria-hidden className="h-20 bg-gradient-to-br from-[#1e1b4b] via-brand-600 to-[#0f172a]">
        <div className="h-full w-full opacity-[0.12] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:14px_14px]" />
      </div>
      <div className="-mt-10 px-4 sm:px-6">
        <div className="flex gap-3">
          <div className="relative h-[88px] w-[88px] flex-none rounded-full ring-4 ring-page shadow-md">{photo}</div>
          {/* The row starts inside the band (-mt-10); the text starts under it. */}
          <div className="min-w-0 flex-1 self-start pt-[46px]">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-[22px] font-extrabold leading-tight text-ink-900" dir="auto">{name}</h1>
              {nameAside}
            </div>
            {chips && <div className="mt-1 flex flex-wrap gap-1">{chips}</div>}
          </div>
        </div>
        <div className="mt-3 rounded-card bg-card p-3 shadow-sm">
          {counts}
          {actions && <div className="mt-3 flex gap-2">{actions}</div>}
        </div>
      </div>
    </section>
  );
}

/** A chip under the name: the pace group in brand, the rest neutral. */
export function HeroChip({ children, brand = false }: { children: ReactNode; brand?: boolean }) {
  return (
    <span
      className={
        brand
          ? 'rounded-full bg-brand-600/10 px-2.5 py-0.5 text-2xs font-bold text-brand-600'
          : 'rounded-full bg-card px-2.5 py-0.5 text-2xs font-bold text-ink-500'
      }
      dir="auto"
    >
      {children}
    </span>
  );
}
