'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/** "Tal Borenstein" -> "TA". Used whenever there's no usable photo. */
export function initialsOf(name: string, maxChars = 2): string {
  const words = (name || '??').trim().split(/\s+/);
  return words.length === 1
    ? words[0].slice(0, maxChars).toUpperCase()
    : words.slice(0, maxChars).map(word => word[0]).join('').toUpperCase();
}

interface Props {
  name: string;
  url: string | null;
  /** Sizing/colour overrides — tailwind-merge lets these win over the defaults. */
  className?: string;
  /** Overrides for the initials text (size/colour). */
  textClassName?: string;
  /** 1 for the tiny like-stack bubbles, where two characters don't fit. */
  maxChars?: number;
}

/** Profile photo with an initials fallback. */
export function FeedAvatar({ name, url, className, textClassName, maxChars = 2 }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = !!url && failedUrl !== url;

  return (
    <div
      className={cn(
        'w-9 h-9 rounded-full bg-brand-600/10 flex items-center justify-center shrink-0 overflow-hidden',
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className={cn('text-brand-600 text-xs font-bold', textClassName)}>
          {initialsOf(name, maxChars)}
        </span>
      )}
    </div>
  );
}
