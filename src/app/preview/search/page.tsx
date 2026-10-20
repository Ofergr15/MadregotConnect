'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { findPlaces } from '@/lib/search/places';
import { PersonActions, PlacesSection, PlanSection, RecordsSection, RunsSection, SearchTabs, type SearchTab } from '@/components/search/SearchExtras';

// The search screen's new result sets on fixed data, for screenshots (mockup search-proposal,
// 10-20). Development only.
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const RUNS = {
  today: [{ title: '10 × 1600', count: 17, names: ['Tarkin', 'Ben', 'Amit', 'Ido', 'Ori'], href: '/dashboard/quality-session' }],
  runs: [
    { id: '1', athleteId: 'me', name: 'Ofer Grosfeld', title: '10 × 1600', date: today, km: 21.1, pace: 257, mine: true },
    { id: '2', athleteId: 'a', name: 'Alon Lifshitz', title: 'Intervals 1600*5', date: '2026-03-10', km: 12.3, pace: 270, mine: false },
    { id: '3', athleteId: 'b', name: 'Itai Spiegel', title: '800-1200-1600 pyramid', date: '2026-09-17', km: 14.0, pace: 268, mine: false },
  ],
};

export default function SearchPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [tab, setTab] = useState<SearchTab>('all');
  return (
    <div className="flex flex-wrap items-start gap-6 bg-page p-6" dir="rtl">
      <div data-shot="q1600" className="w-[390px] space-y-4">
        <SearchTabs tab={tab} onTab={setTab} counts={{ people: 0, runs: 4, plan: 1, places: 0 }} />
        <RunsSection runs={RUNS} />
        <PlanSection sessions={[{ key: 'k', dayOfWeek: 2, name: 'שלישי', type: 'intervals', kmMin: 26, kmMax: 28.5, optional: false, steps: [] } as never]} weekLabel="השבוע" />
      </div>
      <div data-shot="qalon" className="w-[390px] space-y-4">
        <PersonActions person={{ id: 'c515cd04', name: 'Alon Lifshitz', pack: 'Group B · SUB 2:35', lastRunId: 'x' }} staff admin />
        <PlacesSection places={findPlaces({ role: 'admin' }, 'תפקיד')} />
      </div>
      <div data-shot="qhr" className="w-[390px] space-y-4">
        <PlacesSection places={findPlaces({ role: 'runner' }, 'דופק')} />
        <RecordsSection athleteId="me" keys={['10k']} bests={[{ key: '10k', label: '10K', seconds: 2415, date: '2026-09-28', activityId: 'y' }]} />
      </div>
    </div>
  );
}
