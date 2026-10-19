'use client';

import { useState } from 'react';
import { apiHeaders } from '@/lib/api';
import { Sheet } from '@/components/ui/Sheet';
import type { StoryFeature } from '@/lib/stories/gate';

/**
 * Shown to story TESTERS only (lib/stories/gate.ts, state 'testers'): a "בבדיקה" badge
 * and "💬 משוב", which files into the existing feedback queue (/api/feedback → the bug
 * panel) with `context.feature`, so Ofer can tell story feedback apart.
 */
export function StoryTesterBar({ feature, className }: { feature: StoryFeature; className?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const send = async () => {
    if (!text.trim()) return;
    setState('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({
          message: `[סיפור ${feature} · בבדיקה] ${text.trim()}`,
          category: 'general',
          context: { kind: 'story-feedback', feature, page: typeof window !== 'undefined' ? window.location.pathname : null },
        }),
      });
      setState(res.ok ? 'sent' : 'error');
      if (res.ok) setText('');
    } catch {
      setState('error');
    }
  };

  return (
    <div className={className} dir="rtl">
      <div className="flex items-center gap-2">
        <span data-testid="story-testing-badge" className="rounded-full bg-amber-300 px-2 py-0.5 text-3xs font-extrabold text-[#1b1150]">בבדיקה</span>
        <button
          type="button"
          onClick={() => { setOpen(true); setState('idle'); }}
          className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold text-white hover:bg-white/25"
        >
          💬 משוב
        </button>
      </div>
      <Sheet open={open} onOpenChange={setOpen} title="משוב על סיכום השבוע">
        <div className="space-y-3 px-1 pb-2" dir="rtl">
          {state === 'sent' ? (
            <p className="text-sm text-ink-500">תודה! המשוב הגיע.</p>
          ) : (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder="מה עבד? מה לא? מה חסר?"
                className="w-full rounded-xl bg-page p-3 text-sm text-ink-900"
              />
              {state === 'error' && <p className="text-sm text-accent-red">השליחה נכשלה, נסו שוב</p>}
              <button
                type="button"
                disabled={state === 'sending' || !text.trim()}
                onClick={send}
                className="min-h-[48px] w-full rounded-2xl bg-brand-600 text-base font-extrabold text-white disabled:opacity-60"
              >
                שליחה
              </button>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}
