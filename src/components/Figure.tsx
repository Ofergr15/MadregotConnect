'use client';

import { useState } from 'react';

// A safe image wrapper: the box is always a brand-indigo gradient, so during
// load (or if the image fails) it's never blank and never shows a broken
// glyph. Fixed aspect ratio => zero layout shift. On failure, a faint logo
// watermark stands in for the photo.
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
      className={`relative overflow-hidden ${ratio} bg-gradient-to-br from-[#4338ff] to-[#3730d4] ${className}`}
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
