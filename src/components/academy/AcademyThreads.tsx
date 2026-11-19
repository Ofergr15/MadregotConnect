'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBackDismiss } from '@/lib/use-back-dismiss';
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

/**
 * Whether the open thread owns a history entry. It does when it was opened from the
 * inbox (or a `?thread=` deep link), so Back / the iOS swipe closes it to the list
 * instead of leaving the chats area (brief 2026-11-18, 1.3). It does not when it was
 * opened from elsewhere with its own way out (`onExit`, a trainee sheet that already
 * holds an entry): Back there belongs to that sheet.
 */
export function threadOwnsBackEntry(openId: string | null, initialOpenId: string | null, hasExit: boolean): boolean {
  if (!openId) return false;
  return !(hasExit && openId === initialOpenId);
}

/** Open-thread state with Back wired in. Shared by AcademyThreads and the dev preview. */
export function useOpenThread(initialOpenId: string | null, onExit?: () => void) {
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  useEffect(() => { if (initialOpenId) setOpenId(initialOpenId); }, [initialOpenId]);
  const close = useCallback(() => setOpenId(null), []);
  // Reuses the app's overlay-history helper (pushState on open, popstate closes,
  // a tap close pops its own entry) rather than ad-hoc history code.
  useBackDismiss(threadOwnsBackEntry(openId, initialOpenId, !!onExit), close);
  const onBack = onExit && openId === initialOpenId ? onExit : close;
  return { openId, open: setOpenId, onBack };
}

export function AcademyThreads({ initialOpenId = null, onExit }: {
  /**
   * A thread to open straight away — the `?thread=<traineeId>` a staff push lands
   * on (lib/academy/deep-links.ts). Followed when it changes too, so a second push
   * tapped while this tab is already showing opens the new thread.
   */
  initialOpenId?: string | null;
  /** When the thread was opened from elsewhere (a trainee sheet): its back goes there. */
  onExit?: () => void;
} = {}) {
  const { openId, open, onBack } = useOpenThread(initialOpenId, onExit);

  if (!openId) return <ThreadInbox onOpen={open} />;

  return <AcademyThreadPanel athleteId={openId} onBack={onBack} />;
}
