import { notFound } from 'next/navigation';
import { AcademySettingsPanel } from '@/components/AcademySettings';

// ── Login-free preview of the academy settings screen ───────────────────────
//
// Same reason as the feedback preview next door: the real screen sits behind a
// session and a staff flag, so checking its layout on a phone means lining up
// three things first. The panel's own GET is unauthenticated (club-wide coach
// content), so rendering it here shows the REAL saved values, not fixtures —
// only the save button needs a session, and it says so on screen.
//
// Development only. In production the route does not exist.

export const dynamic = 'force-dynamic';

export default function AcademySettingsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-screen bg-page px-3 py-4" dir="rtl">
      <div className="mx-auto max-w-[390px] space-y-4">
        <header className="pt-2">
          <h1 className="text-lg font-bold text-ink-900">הגדרות האקדמיה</h1>
          <p className="mt-1 text-xs text-ink-400">
            תצוגה מקדימה בלי התחברות — הערכים הם האמיתיים, השמירה היא זו שדורשת התחברות.
          </p>
        </header>
        <AcademySettingsPanel />
      </div>
    </div>
  );
}
