'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/** "Tal Borenstein" -> "TA". Used whenever there's no usable photo. */
export function initialsOf(name: string, maxChars = 2): string {
  return (name || '??').trim().slice(0, maxChars).toUpperCase();
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

/**
 * Profile photo with an initials fallback.
 *
 * Falls back on BOTH "no URL stored" and "URL stored but the image failed to
 * load" — the second case is the common one: Google serves every avatar from
 * lh3.googleusercontent.com, and drops the request when the browser sends a
 * Referer, so those photos 403 in-page while working fine over curl.
 * `referrerPolicy="no-referrer"` is what actually makes them load; onError is
 * the safety net for expired or deleted photos.
 */
export function FeedAvatar({ name, url, className, textClassName, maxChars = 2 }: Props) {
  // Keyed by URL rather than a boolean so a changed photo gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = !!url && failedUrl !== url;

  return (
    <div
      className={cn(
        'w-9 h-9 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden',
        className,
      )}
    >
      {showImage ? (
        // Avatar origins aren't known at build time (Google, Supabase storage),
        // so next/image would need every domain allow-listed.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className={cn('text-primary-400 text-xs font-bold', textClassName)}>
          {initialsOf(name, maxChars)}
        </span>
      )}
    </div>
  );
}
