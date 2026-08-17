'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageProps } from 'stream-chat-react';

/**
 * Contained clipboard thumbnail + lightbox that closes on outside click / Escape.
 * Lightbox is portaled to <body> so Stream's attachment img CSS (object-fit:cover)
 * cannot crop the focused image.
 */
export function RunChatImage(item: ImageProps & { layout?: 'thumbnail' | 'full' }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const src = item.imageUrl;
  const alt = item.alt || item.title || 'תוכנית אימון';

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!src) return null;

  const lightbox =
    open && mounted
      ? createPortal(
          <div
            className="run-chat-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            onClick={() => setOpen(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="run-chat-lightbox__img"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              className="run-chat-lightbox__close"
              onClick={() => setOpen(false)}
              aria-label="סגור"
            >
              ×
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        className={`run-chat-clipboard-thumb ${
          item.layout === 'full' ? 'run-chat-laps-panel' : ''
        }`}
        onClick={() => setOpen(true)}
        aria-label="הגדל תמונה"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} />
      </button>
      {lightbox}
    </>
  );
}
