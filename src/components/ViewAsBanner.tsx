'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initialsOf } from '@/components/FeedAvatar';
import {
  getViewedPerson,
  stopViewingAs,
  VIEW_AS_BLOCKED_EVENT,
  type ViewedPerson,
} from '@/lib/view-as-person';

// The orange strip under the top bar while an admin views the app as somebody
// (lib/view-as-person.ts) — on every screen of the shell, so nobody forgets whose
// eyes they are looking through. "יציאה" returns to the same screen as yourself.
//
// It also owns the read-only toast: a write the person tapped never leaves the
// browser while viewing, and the overlay announces it with VIEW_AS_BLOCKED_EVENT.
// Saying why here, once, is what keeps every screen's own error path ("couldn't
// save") from firing for a button that did exactly what it should.

const AMBER_INK = '#B45309';
const AMBER_TINT = '#FEF3C7';
const TOAST_MS = 3200;
// Above the bottom sheets (SheetDrawer is z-300/310): the chat composer that
// raises it most often lives inside one.

export function ViewAsBanner() {
  const t = useTranslations('viewAs');
  const [person, setPerson] = useState<ViewedPerson | null>(null);
  const [toast, setToast] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setPerson(getViewedPerson()); }, []);

  useEffect(() => {
    const onBlocked = () => {
      setToast(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(false), TOAST_MS);
    };
    window.addEventListener(VIEW_AS_BLOCKED_EVENT, onBlocked);
    return () => {
      window.removeEventListener(VIEW_AS_BLOCKED_EVENT, onBlocked);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!person) return null;
  const first = person.name.split(' ')[0] || person.name;

  return (
    <>
      <div
        dir="rtl"
        role="status"
        data-testid="view-as-banner"
        className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b px-4 py-1.5"
        style={{ background: AMBER_TINT, color: AMBER_INK, borderColor: '#FDE68A' }}
      >
        <Avatar className="size-8">
          {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
          <AvatarFallback className="text-xs font-bold text-white" style={{ background: AMBER_INK }}>
            {initialsOf(person.name)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-bold">{t('bannerAs', { name: person.name })}</span>
          <span className="block truncate text-xs font-medium opacity-85">
            {t(`tag_${person.tag}`)} · {t('readOnly')}
          </span>
        </span>
        <button
          type="button"
          onClick={() => stopViewingAs()}
          className="min-h-[36px] shrink-0 rounded-pill px-3.5 text-xs font-bold text-white active:scale-95"
          style={{ background: AMBER_INK }}
        >
          {t('exit')}
        </button>
      </div>

      {toast && (
        <div
          dir="rtl"
          role="alert"
          data-testid="view-as-toast"
          className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-[400] mx-auto max-w-sm rounded-xl px-4 py-3 text-center text-sm font-semibold shadow-lg"
          style={{ background: AMBER_TINT, color: AMBER_INK, border: '1px solid #FDE68A' }}
        >
          {t('blockedToast', { name: first })}
        </div>
      )}
    </>
  );
}
