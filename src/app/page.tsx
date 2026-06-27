'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const coachEmail = localStorage.getItem('coach_email');
    const athleteId = localStorage.getItem('athlete_id');

    if (coachEmail) {
      router.replace('/dashboard');
    } else if (athleteId) {
      router.replace('/dashboard/program');
    } else {
      router.replace('/login');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
    </div>
  );
}
