'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
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
  const tCommon = useTranslations('common');
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

  /**
   * Closing has to stop the event here (828aaf40).
   *
   * `createPortal` moves the DOM node to document.body but NOT the React tree, so
   * a click in here still bubbles through every React ancestor of the
   * `<PhotoLightbox>` element — including, if a caller renders this inside the
   * very thing that opens it, the handler that opens it. That is what happened in
   * FeedAvatar: tapping the X set `enlarged` false and the same event then set it
   * true again, so the overlay never went away and the button read as dead.
   *
   * FeedAvatar now renders this as a sibling, but a lightbox that can only be
   * closed depending on where the caller put it is a trap, so the guard lives
   * here too.
   */
  const close = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={close}
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
        onClick={close}
        // Not `alt` — that is the person's name, which is the DIALOG's label. A
        // close button announced as "Yossi Cohen" tells a screen reader nothing
        // about what pressing it does.
        aria-label={tCommon('close')}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] end-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
      >
        <X className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  );
}
