import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_VERSION } from '@/lib/version';
import { CROSS_CUTTING_QUESTIONS, FLOW_STEPS, flowCounts, type FlowStep } from '@/lib/academy/flow-map';

// ── The front door to the academy flow ───────────────────────────────────────
//
// Nineteen preview screens were built on this branch and there was no way in: seeing the flow
// meant knowing the URLs. This page walks the fifteen steps in the order they happen, links the
// screen that serves each one, and puts every open decision beside the step it actually blocks —
// so the walkthrough and the list of questions are one artefact instead of two.
//
// A server component, and static: there is nothing here to fetch. The data is in
// `lib/academy/flow-map.ts`, where a test can resolve every link against the repo — a walkthrough
// that links a deleted screen claims the flow is complete when a piece of it is gone.
//
// Development only, like every other page in this directory. The in-app links it offers do work
// in production, but they need staff and real data; the previews do not exist there.

export const dynamic = 'force-static';

const STATE_LABEL: Record<FlowStep['state'], string> = {
  inApp: 'במערכת',
  partly: 'חלקית',
  outsideApp: 'מחוץ למערכת',
};

/** Blue for what the app does, band-3 for shared, grey for what deliberately stays out. */
const STATE_CLASS: Record<FlowStep['state'], string> = {
  inApp: 'bg-brand-600/15 text-brand-600',
  partly: 'bg-band-3/15 text-band-3',
  outsideApp: 'bg-ink-300/40 text-ink-500',
};

export default function AcademyFlowIndex() {
  if (process.env.NODE_ENV === 'production') notFound();

  const counts = flowCounts();

  return (
    <div className="min-h-screen bg-page px-3 py-4" dir="rtl">
      <div className="mx-auto max-w-[430px] space-y-4">
        <header className="pt-2">
          <h1 className="text-xl font-bold text-ink-900">האקדמיה — התהליך והמסכים</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
            חמישה-עשר השלבים כפי שתיארת אותם, ומה שיש עכשיו לכל אחד. ליד כל שלב מופיעה ההחלטה
            שממתינה לך, אם יש כזו. שום דבר מזה עוד לא במערכת החיה.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-medium">
            <span className="rounded-full bg-brand-600/15 px-2 py-1 text-brand-600">
              <bdi dir="ltr">{counts.inApp}</bdi> שלבים במערכת
            </span>
            <span className="rounded-full bg-band-3/15 px-2 py-1 text-band-3">
              <bdi dir="ltr">{counts.partly}</bdi> חלקית
            </span>
            <span className="rounded-full bg-ink-300/40 px-2 py-1 text-ink-500">
              <bdi dir="ltr">{counts.outsideApp}</bdi> מחוץ למערכת
            </span>
            <span className="rounded-full bg-ink-300/40 px-2 py-1 text-ink-500">
              <bdi dir="ltr">{counts.questions}</bdi> החלטות פתוחות
            </span>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-400">
            גרסה <bdi dir="ltr">{APP_VERSION}</bdi> · הכל יושב על ענף נפרד ולא על הראשי, כך
            שהמערכת החיה לא השתנתה. המיגרציות כבר הורצו, ומה שנותר הוא החלטה אחת: למזג ולפרסם.
          </p>
        </header>

        <ol className="space-y-2.5">
          {FLOW_STEPS.map(step => (
            <li key={step.n} className="rounded-2xl border border-page bg-card p-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-ink-300/40 text-[11px] font-bold text-ink-500">
                  <bdi dir="ltr">{step.n}</bdi>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <h2 className="flex-1 text-sm font-bold leading-snug text-ink-900">{step.title}</h2>
                    <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATE_CLASS[step.state]}`}>
                      {STATE_LABEL[step.state]}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-400">
                    {step.owner} · היום: {step.today}
                  </p>

                  {/* What changed. Empty on the steps nothing was built for, and an empty line is
                      more honest there than a sentence inventing a change. */}
                  {step.built && (
                    <p className="mt-2 text-xs leading-relaxed text-ink-700">{step.built}</p>
                  )}

                  {step.screens.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {step.screens.map(screen => (
                        <Link
                          key={screen.href}
                          href={screen.href}
                          className={`inline-flex min-h-[44px] items-center rounded-xl px-3 text-xs font-semibold ${
                            screen.kind === 'preview'
                              ? 'bg-brand-600 text-white'
                              : 'border border-page bg-page text-ink-700'
                          }`}
                        >
                          {screen.label}
                        </Link>
                      ))}
                    </div>
                  )}

                  {step.questions.length > 0 && (
                    <ul className="mt-2.5 space-y-1.5 rounded-xl bg-band-3/10 p-2.5">
                      {step.questions.map(q => (
                        <li key={q} className="text-[11px] leading-relaxed text-band-3">
                          {q}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>

        <section className="rounded-2xl border border-page bg-card p-3">
          <h2 className="text-sm font-bold text-ink-900">החלטות שאינן של שלב מסוים</h2>
          <ul className="mt-2 space-y-2">
            {CROSS_CUTTING_QUESTIONS.map(q => (
              <li key={q} className="text-xs leading-relaxed text-ink-700">{q}</li>
            ))}
          </ul>
        </section>

        <p className="px-1 pb-6 text-[11px] leading-relaxed text-ink-400">
          הכפתורים הכחולים הם תצוגות בלי התחברות, וקיימים רק בסביבת הפיתוח. האפורים הם המסך
          האמיתי במערכת, ודורשים התחברות ונתונים.
        </p>
      </div>
    </div>
  );
}
