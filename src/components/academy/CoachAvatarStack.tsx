'use client';

import { cn } from '@/lib/utils';
import { initialsOf } from './types';

// A trainee's coaches as overlapping faces (mockup academy-multi-coach.html):
// "DL GZ" in the member sheet's coaches row and the trainee's own home header.
// Each coach keeps one colour by position, so Dana is the same blue everywhere.

const TONES = ['bg-brand-600', 'bg-band-2', 'bg-violet-600'];

export interface StackCoach { id: string; name: string; avatarUrl?: string | null }

export function CoachAvatarStack({
  coaches, size = 28, max = 3, className,
}: {
  coaches: StackCoach[];
  size?: number;
  /** Faces drawn before "+N". */
  max?: number;
  className?: string;
}) {
  if (!coaches.length) return null;
  const shown = coaches.slice(0, max);
  const extra = coaches.length - shown.length;
  const overlap = Math.round(size * 0.3);
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)} aria-hidden>
      {shown.map((c, i) => (
        <span
          key={c.id}
          style={{ width: size, height: size, marginInlineStart: i === 0 ? 0 : -overlap, fontSize: Math.max(9, Math.round(size * 0.36)) }}
          className={cn(
            'grid place-items-center overflow-hidden rounded-full border-2 border-white font-extrabold text-white',
            TONES[i % TONES.length],
          )}
        >
          {c.avatarUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />
            : initialsOf(c.name || '?')}
        </span>
      ))}
      {extra > 0 && (
        <span
          style={{ width: size, height: size, marginInlineStart: -overlap, fontSize: Math.max(9, Math.round(size * 0.34)) }}
          className="grid place-items-center rounded-full border-2 border-white bg-ink-300 font-extrabold text-white"
        >
          <bdi dir="ltr">+{extra}</bdi>
        </span>
      )}
    </span>
  );
}
