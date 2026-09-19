'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * A profile photo, full screen.
 *
 * Reported (21cc272c) as "לחיצה על תמונה של user צריכה לפתוח את התמונה ביותר
 * גדול" — tapping a user's photo should open it bigger. Every avatar in the app is
 * between 32 and 64 pixels across, which is enough to recognise somebody you
 * already know and not enough to actually look at the picture.
 *
 * Where this is offered is deliberately narrow. Almost every avatar in the app
 * sits inside an `AthleteLink`, where the tap already means "go to this person's
 * profile" — a more useful answer than a bigger thumbnail, and one that would be
 * stolen by putting an enlarge handler on it. So the affordance lives on the two
 * screens where the photo is the subject rather than a label: your own profile
 * header and a teammate's.
 *
 * Modelled on `run-chat/RunChatImage`, which is the app's other lightbox: a portal
 * to document.body (so no ancestor's overflow or transform can clip it), Escape to
 * close, the page's scroll frozen while it is open, and a tap anywhere outside the
 * photo closing it. The difference is that this one is Tailwind only — RunChatImage
 * reaches into run-chat.css, and a shared component cannot depend on one screen's
 * stylesheet.
 */
export function PhotoLightbox({
  url,
  alt,
  onClose,
}: {
  url: string;
  alt: string;
  onClose: () => void;
}) {
  // Portals need a DOM, and this renders inside server-rendered pages.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Without this the page scrolls behind the overlay under a phone's momentum,
    // and closing leaves you somewhere you never navigated to.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        referrerPolicy="no-referrer"
        // The photo itself is not a close target: pinching to zoom starts with a
        // touch on the image, and that must not dismiss the thing being zoomed.
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label={alt}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] end-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
      >
        <X className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  );
}
