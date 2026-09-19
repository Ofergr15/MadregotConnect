'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PhotoLightbox } from '@/components/PhotoLightbox';

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
  /**
   * Tap the photo to see it full screen (21cc272c).
   *
   * Opt-in, and off by default on purpose: most avatars sit inside an
   * `AthleteLink`, where the tap already opens the person's profile. Adding a
   * handler here would swallow that. See PhotoLightbox for where it IS offered.
   *
   * Has no effect without a real photo — there is nothing to enlarge about two
   * initials, and a tap that sometimes does nothing is worse than one that never
   * does anything.
   */
  enlargeable?: boolean;
}

/** Profile photo with an initials fallback. */
export function FeedAvatar({
  name,
  url,
  className,
  textClassName,
  maxChars = 2,
  enlargeable = false,
}: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const showImage = !!url && failedUrl !== url;
  const canEnlarge = enlargeable && showImage;

  return (
    <>
      {/* A SIBLING of the tappable circle, never a child (828aaf40). The lightbox
          portals itself to document.body, but a React portal still bubbles its
          events up the React tree — so while it lived inside this div, every tap
          in it, the X included, reached the onClick below and re-opened what had
          just closed. The fragment adds no DOM, so no caller's layout moves. */}
      {canEnlarge && enlarged && url && (
        <PhotoLightbox url={url} alt={name} onClose={() => setEnlarged(false)} />
      )}
      <div
        className={cn(
          'w-9 h-9 rounded-full bg-brand-600/10 flex items-center justify-center shrink-0 overflow-hidden',
          className,
        )}
      // A button element would change the layout of every caller (buttons carry
      // their own box), so the role goes on the div that already draws the circle.
        {...(canEnlarge
          ? {
              role: 'button' as const,
              tabIndex: 0,
              onClick: () => setEnlarged(true),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEnlarged(true);
                }
              },
            }
          : {})}
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
    </>
  );
}
