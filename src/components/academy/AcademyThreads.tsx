'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { ThreadInbox } from './ThreadInbox';
import { AcademyThreadPanel } from './AcademyThreadPanel';

// ── The staff side of the thread ────────────────────────────────────────────
//
// Inbox, then one thread. Deliberately a REPLACEMENT and not a split view: at 393px
// there is no room for a list beside a conversation, and the two-pane version of this
// screen on a phone means both halves are too narrow to read.
//
// The inbox is remounted when you come back rather than cached, which is the point —
// you have just replied to somebody, so the row that sent you in there has changed
// band and the order is now different. A stale list would still be showing them as
// owed an answer.

export function AcademyThreads() {
  const [openId, setOpenId] = useState<string | null>(null);

  if (!openId) return <ThreadInbox onOpen={setOpenId} />;

  return (
    <div dir="rtl">
      <button
        onClick={() => setOpenId(null)}
        // A real 44px target: the audit measures this, and a back affordance that
        // misses is worse here than elsewhere because the thread has no other exit.
        className="mb-2 -ms-2 flex min-h-[44px] items-center gap-1 px-2 text-sm text-brand-600"
      >
        <ChevronRight className="h-4 w-4" />
        לכל השיחות
      </button>
      <AcademyThreadPanel athleteId={openId} />
    </div>
  );
}
