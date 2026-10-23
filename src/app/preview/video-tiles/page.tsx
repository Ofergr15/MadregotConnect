'use client';

import { notFound } from 'next/navigation';
import { Play } from 'lucide-react';

// The video tiles' mark, for screenshots. Development only.
export default function TilesPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const g = ['#355C7D,#6C5B7B', '#0F2027,#2C5364', '#C06C84,#6C5B7B', '#2C3E50,#4CA1AF', '#F67280,#C06C84', '#134E5E,#71B280'];
  return (
    <div className="grid w-[390px] grid-cols-3 gap-[3px] bg-page" dir="rtl" data-shot="tiles">
      {g.map((c, k) => (
        <div key={k} className="relative aspect-[9/14] overflow-hidden" style={{ background: `linear-gradient(160deg,${c})` }}>
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/55 to-transparent" />
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[11.5px] font-bold text-white drop-shadow">
            <Play className="h-3 w-3" fill="currentColor" strokeWidth={0} /><bdi dir="ltr">0:{String(8 + k * 7).padStart(2, '0')}</bdi>
          </span>
        </div>
      ))}
    </div>
  );
}
