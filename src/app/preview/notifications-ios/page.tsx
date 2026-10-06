'use client';

import { notFound } from 'next/navigation';
import { BellRing, HeartHandshake, MessageCircle, CalendarCheck } from 'lucide-react';
import { IosPermissionPreview } from '@/components/install/IosPermissionPreview';

// Login-free preview of the first-run notifications step as an iPhone sees it in
// onboarding v2 (the real step needs a session). Same copy as messages/he pushStep.
// Development only.
export default function NotificationsIosPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const benefits = [
    { icon: HeartHandshake, text: 'לייקים ותגובות על הריצות שלכם' },
    { icon: MessageCircle, text: 'תשובות מהמאמן למשוב שלכם' },
    { icon: CalendarCheck, text: 'שינויים בתוכנית השבועית' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" dir="rtl">
      <div className="w-full max-w-md rounded-t-3xl bg-card px-5 pb-7 pt-6 shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600/15"><BellRing className="h-8 w-8 text-brand-600" /></div>
        <h2 className="mt-3.5 text-center text-lg font-bold text-ink-700">עכשיו — מפעילים התראות</h2>
        <p className="mx-auto mt-2 max-w-[300px] text-center text-13 font-light leading-relaxed text-ink-400">כך מדרגות מגיעה אליכם כשהאפליקציה סגורה. הקשה אחת, פעם אחת.</p>
        <ul className="mt-4 flex flex-col gap-3">
          {benefits.map((b, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-600/15"><b.icon className="h-3.5 w-3.5 text-brand-600" /></span>
              <span className="text-13 text-ink-700">{b.text}</span>
            </li>
          ))}
        </ul>
        <IosPermissionPreview />
        <div className="mt-5 flex flex-col gap-2.5">
          <button type="button" className="flex min-h-[48px] w-full items-center justify-center rounded-pill bg-brand-600 text-[15px] font-bold text-white">הפעלת התראות</button>
          <button type="button" className="flex min-h-[48px] w-full items-center justify-center rounded-pill border border-page text-[15px] font-bold text-ink-700">לא עכשיו</button>
        </div>
      </div>
    </div>
  );
}
