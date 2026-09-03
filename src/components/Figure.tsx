'use client';

import { useState } from 'react';

// A safe image wrapper: the box is always a solid brand-blue plate, so during
// load (or if the image fails) it's never blank and never shows a broken
// glyph. Fixed aspect ratio => zero layout shift. On failure, a faint white logo
// watermark stands in for the photo — which is why the plate has to stay a
// saturated colour and not become a light card.
export function Figure({
  src,
  alt,
  ratio = 'aspect-[16/9]',
  priority = false,
  className = '',
  imgClassName = '',
}: {
  src: string;
  alt: string;
  ratio?: string;
  priority?: boolean;
  className?: string;
  imgClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`relative overflow-hidden ${ratio} bg-brand-600 ${className}`}
    >
      {!failed && (
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover object-center ${imgClassName}`}
        />
      )}
      {failed && (
        <img
          src="/images/logo-white.png"
          alt=""
          aria-hidden="true"
          className="absolute start-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 opacity-30"
        />
      )}
    </div>
  );
}
