'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { isIosSafari, isStandalone } from '@/lib/pwa';
import { openDecision, safeTarget } from '@/lib/open-in-app';

/**
 * /open?to=/dashboard/… — see lib/open-in-app.ts for why this exists (#76).
 *
 * Hardcoded Hebrew like /register: it is only reached from the club's own staff
 * emails, and it has no locale switcher to reach.
 */
function OpenInApp() {
  const params = useSearchParams();
  const to = safeTarget(params.get('to'));
  const [decision, setDecision] = useState<'forward' | 'handoff' | null>(null);

  useEffect(() => {
    const d = openDecision({ standalone: isStandalone(), iosSafari: isIosSafari() });
    if (d === 'forward') window.location.replace(to);
    else setDecision(d);
  }, [to]);

  // Nothing to show while forwarding: the next screen is a moment away.
  if (decision !== 'handoff') return <div className="min-h-dvh bg-page" />;

  return (
    <div dir="rtl" lang="he" className="min-h-dvh bg-page flex flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <Image src="/images/icon-192.png" alt="" width={72} height={72} className="rounded-[18px] shadow-lg" priority />
      <div className="space-y-2">
        <h1 className="text-[24px] font-black text-ink-700">פתחו את מדרגות ממסך הבית</h1>
        <p className="text-[15px] leading-relaxed text-ink-500">
          באייפון, קישור ממייל נפתח תמיד בספארי ולא באפליקציה, ובספארי אתם לא מחוברים.
        </p>
      </div>
      <ol className="w-full max-w-sm space-y-2 rounded-card bg-card p-4 text-start text-[15px] text-ink-700">
        <li className="flex items-center gap-3"><Step n={1} />חזרו למסך הבית</li>
        <li className="flex items-center gap-3"><Step n={2} />הקישו על הסמל של מדרגות</li>
        {/* Only the entry queue has a card on the home screen to point at. */}
        {to.startsWith('/dashboard/entry-queue') && (
          <li className="flex items-center gap-3"><Step n={3} />מי שממתין לאישור מופיע בראש המסך</li>
        )}
      </ol>
      <p className="max-w-sm text-xs text-ink-400">
        ההתראה שנשלחת לטלפון על אותו דבר נפתחת ישר באפליקציה.
      </p>
      <a href={to} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-600">
        להמשיך כאן בדפדפן
      </a>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-extrabold text-white">
      {n}
    </span>
  );
}

export default function OpenPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-page" />}>
      <OpenInApp />
    </Suspense>
  );
}
