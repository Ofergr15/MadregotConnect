'use client';

import { useCallback, useState, type ReactNode } from 'react';

// An in-app confirmation instead of window.confirm(). In an installed PWA the
// browser's native dialog looks like the browser breaking through the app (see the
// notes in dashboard/profile and dashboard/entry-queue), and on a phone it gives
// the warning text no room. This keeps the warning, puts "yes" and "cancel" in
// clearly different buttons, and is one line per call site:
//
//   const { ask, confirmUi } = useConfirm();
//   onClick={() => ask('למחוק את ההזמנה?', () => void remove())}
//   ...
//   {confirmUi}
//
// Nothing runs until the second, different-looking button is pressed.

interface Pending { message: string; confirmLabel: string; run: () => void }

export function useConfirm(): { ask: (message: string, run: () => void, confirmLabel?: string) => void; confirmUi: ReactNode; pending: boolean } {
  const [req, setReq] = useState<Pending | null>(null);
  const ask = useCallback((message: string, run: () => void, confirmLabel = 'כן, להמשיך') => {
    setReq({ message, run, confirmLabel });
  }, []);
  const confirmUi = req ? (
    <ConfirmStrip
      message={req.message}
      confirmLabel={req.confirmLabel}
      onConfirm={() => { const run = req.run; setReq(null); run(); }}
      onCancel={() => setReq(null)}
    />
  ) : null;
  return { ask, confirmUi, pending: !!req };
}

export function ConfirmStrip({ message, confirmLabel, onConfirm, onCancel }: {
  message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label={message}
      dir="rtl"
      className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md rounded-card bg-card p-4 shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
    >
      <p className="text-[14.5px] font-bold leading-snug text-ink-900">{message}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onConfirm} className="flex min-h-[44px] flex-1 items-center justify-center rounded-pill bg-accent-red text-[14px] font-extrabold text-white">
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} autoFocus className="flex min-h-[44px] flex-1 items-center justify-center rounded-pill bg-page text-[14px] font-extrabold text-ink-700">
          ביטול
        </button>
      </div>
    </div>
  );
}
