'use client';

// The "we got it" screen of onboarding v2 (lib/install/flag): the same 4-step
// journey the approval mail and the install guide draw, so a new member always
// sees where they are and that there is nothing to do but wait for one thing.

import Link from 'next/link';
import { cn } from '@/lib/utils';

const STEPS = ['הרשמה', 'אישור', 'התקנה', 'כניסה'];

export function Journey({ done }: { done: number }) {
  return (
    <ol className="flex items-start justify-between px-1" aria-label={`שלב ${done + 1} מתוך 4`}>
      {STEPS.map((label, i) => {
        const isDone = i < done, isAt = i === done;
        return (
          <li key={label} className="flex flex-1 items-start">
            <div className="flex w-14 flex-col items-center gap-1">
              <span className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-black',
                isDone ? 'border-brand-600 bg-brand-600 text-white'
                  : isAt ? 'border-brand-600 bg-card text-brand-600 shadow-[0_0_0_4px_rgba(67,56,255,0.15)]'
                    : 'border-ink-300 bg-card text-ink-400',
              )}>{isDone ? '✓' : i + 1}</span>
              <span className={cn('text-3xs font-bold', isAt ? 'text-ink-700' : isDone ? 'text-brand-600' : 'text-ink-400')}>{label}</span>
            </div>
            {i < STEPS.length - 1 && <span className={cn('mt-3.5 h-0.5 flex-1', i < done ? 'bg-brand-600' : 'bg-ink-300')} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export function RegisterReceived({ state, email, name }: { state: 'new' | 'pending' | 'member'; email: string; name: string }) {
  const first = name.split(/\s+/)[0] || '';
  const title = state === 'member' ? 'כבר יש לך חשבון 🙌' : state === 'pending' ? 'כבר קיבלנו אותך 🙌' : `קיבלנו${first ? `, ${first}` : ''} 🙌`;
  return (
    <div className="min-h-viewport bg-page" dir="rtl">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-5 pb-10 pt-[max(18px,env(safe-area-inset-top))]">
        <div className="rounded-[24px] bg-gradient-to-br from-[#2b33ff] via-brand-600 to-[#6a5cff] px-4 pb-5 pt-4 text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo-white.png" alt="מדרגות" className="mx-auto h-14 w-auto" />
          <p className="mt-2 text-2xs font-bold tracking-wide text-white/85">מועדון הריצה של מדרגות</p>
          <h1 className="mt-0.5 text-2xl font-black">{title}</h1>
          <p className="mt-0.5 text-13 text-white/90">{state === 'member' ? 'אין צורך להירשם שוב' : 'הבקשה שלך אצלנו'}</p>
        </div>

        {state === 'member' ? (
          <div className="rounded-2xl bg-card p-4 text-center">
            <p className="text-sm leading-relaxed text-ink-700">הכתובת <bdi dir="ltr" className="font-semibold">{email}</bdi> כבר רשומה במדרגות.</p>
            <Link href="/" className="mt-3 inline-flex min-h-[48px] items-center justify-center rounded-pill bg-brand-600 px-6 text-sm font-black text-white">לכניסה לאפליקציה</Link>
          </div>
        ) : (
          <>
            <Journey done={1} />
            <div className="rounded-2xl bg-brand-600/10 p-4 text-center">
              <p className="text-3xs font-black tracking-wide text-brand-600">הבא בתור</p>
              <p className="mt-0.5 text-base font-black text-ink-700">אישור מהמנהלים</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                בדרך כלל תוך יום. נשלח לך מייל עם קישור אישי לכתובת<br />
                <bdi dir="ltr" className="font-semibold text-ink-700">{email}</bdi>
              </p>
            </div>
            <div className="rounded-2xl border border-page bg-card p-3.5">
              <p className="text-3xs font-black text-ink-400">אפשר להתכונן כבר עכשיו</p>
              <div className="mt-2 flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-page text-lg" aria-hidden>⌚</span>
                <div><p className="text-sm font-bold text-ink-700">יש לך Strava?</p><p className="text-xs leading-relaxed text-ink-500">כך נכנסים לאפליקציה ורואים את הריצות. אין? אפשר להוריד אותה בחינם.</p></div>
              </div>
              <div className="mt-3 flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-page text-lg" aria-hidden>📱</span>
                <div><p className="text-sm font-bold text-ink-700">את המייל פותחים בטלפון</p><p className="text-xs leading-relaxed text-ink-500">שם ההתקנה לוקחת דקה, והמסך יראה בדיוק איך.</p></div>
              </div>
            </div>
            <p className="text-center text-xs leading-relaxed text-ink-400">אין צורך לעשות שום דבר נוסף בינתיים.<br />לא הגיע מייל תוך יום? כדאי לבדוק בספאם.</p>
          </>
        )}
      </div>
    </div>
  );
}
