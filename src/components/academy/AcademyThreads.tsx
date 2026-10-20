'use client';

import { useEffect, useState } from 'react';
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

export function AcademyThreads({ initialOpenId = null }: {
  /**
   * A thread to open straight away — the `?thread=<traineeId>` a staff push lands
   * on (lib/academy/deep-links.ts). Followed when it changes too, so a second push
   * tapped while this tab is already showing opens the new thread.
   */
  initialOpenId?: string | null;
} = {}) {
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  useEffect(() => { if (initialOpenId) setOpenId(initialOpenId); }, [initialOpenId]);

  if (!openId) return <ThreadInbox onOpen={setOpenId} />;

  return <AcademyThreadPanel athleteId={openId} onBack={() => setOpenId(null)} />;
}
