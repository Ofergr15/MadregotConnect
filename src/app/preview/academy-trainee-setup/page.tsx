'use client';

import { notFound } from 'next/navigation';
import { TraineeSetupBanner } from '@/components/academy/TraineeSetup';

// The coach's "טופס התאמה" banner and sheet on their own, for the UI audit (fixtures mock
// /api/academy/trainee-setup and /api/academy/characterization). ?setup=1 opens the sheet.
// Development only.
export default function TraineeSetupPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <div className="min-h-screen bg-page p-4" dir="rtl">
      <TraineeSetupBanner athleteId="00000000-0000-4000-8000-000000000001" />
    </div>
  );
}
