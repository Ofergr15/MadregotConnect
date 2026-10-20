'use client';

import type { ReactNode } from 'react';
import { untilLabel } from '@/lib/publish/pin';

// "נעוץ בראש הפיד" (mockup publish-preview-v2): a club post that sits first until its
// time. The same frame on the feed and in the publish screen's preview, so what the
// editor sees is what goes up.

export function PinnedFrame({ until, children }: { until: string | null; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 px-2 text-[12px] font-extrabold text-[#B45309]">
        <span aria-hidden>📌</span>נעוץ למעלה
        {until && <span className="ms-auto rounded-full bg-[#FEF3C7] px-2.5 py-0.5 text-[11.5px] font-bold">{untilLabel(until)}</span>}
      </div>
      <div className="rounded-[28px] ring-2 ring-[#F59E0B] ring-offset-0 shadow-[0_8px_20px_-10px_rgba(245,158,11,0.55)]">{children}</div>
    </div>
  );
}
