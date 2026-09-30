import Link from 'next/link';
import { GraduationCap } from 'lucide-react';
import { academyShareMetadata } from '@/lib/academy/share-metadata';

/**
 * /academy — the page the Instagram bio links to (door B; see lib/academy/intake.ts).
 *
 * It opens inside Instagram's in-app browser, from a stranger who has never heard of
 * the app, so it says three things and has one button: what the academy is, how
 * it goes, and "start". No login, no install. The button carries `src` on to the
 * form, which is how the card it creates says where the person came from.
 */
export const metadata = academyShareMetadata(
  'אקדמיית מדרגות · Madregot Academy',
  'מאמן אישי, תוכנית שלך. ליווי 1:1 בריצה.',
);

const HOW = [
  'טופס קצר · 5 דקות',
  'שיחת היכרות',
  'מבחן כושר ותוכנית ראשונה',
  'מתחילים לרוץ עם מאמן',
];

export default async function AcademyLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>;
}) {
  const { src } = await searchParams;
  const href = `/academy-register?src=${encodeURIComponent(src === 'form' ? 'form' : 'ig')}`;
  return (
    <div className="min-h-screen bg-page px-5 py-10" dir="rtl">
      <div className="mx-auto max-w-md">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600/20 ring-1 ring-brand-600/20">
          <GraduationCap className="h-7 w-7 text-brand-600" />
        </div>
        <p className="text-sm font-bold text-brand-600">אקדמיית מדרגות</p>
        <h1 className="mt-1 text-[28px] font-black leading-tight text-ink-700">
          מאמן אישי.
          <br />
          תוכנית שלך.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-500">
          ליווי 1:1, מבחן כושר, ותוכנית שבועית שמתעדכנת לפי מה שרצת באמת.
        </p>

        <div className="mt-6 rounded-card bg-card p-4">
          <h2 className="mb-2 text-sm font-bold text-ink-700">איך זה עובד</h2>
          <ol className="space-y-2">
            {HOW.map((line, i) => (
              <li key={line} className="flex min-h-[40px] items-center gap-3 text-base text-ink-700">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  <bdi dir="ltr">{i + 1}</bdi>
                </span>
                {line}
              </li>
            ))}
          </ol>
        </div>

        <Link
          href={href}
          className="mt-6 flex min-h-[52px] w-full items-center justify-center rounded-pill bg-brand-600 text-base font-bold text-white"
        >
          אני רוצה להצטרף
        </Link>
        <p className="mt-3 text-center text-sm text-ink-400">בלי הורדה, בלי סיסמה. עובד מכאן.</p>
      </div>
    </div>
  );
}
