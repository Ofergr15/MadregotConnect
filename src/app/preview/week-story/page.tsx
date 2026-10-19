'use client';

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WeekStory } from '@/components/week-story/WeekStory';
import type { WeekStory as Story } from '@/lib/week-story/server';

// The week story on stories read from /preview-week.json (a local file, never committed —
// real people's weeks), `?i=` picks one. Development only.

export default function PreviewWeekStory() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [story, setStory] = useState<Story | null>(null);
  useEffect(() => {
    const i = Number(new URLSearchParams(window.location.search).get('i') || 0);
    fetch('/preview-week.json').then((r) => r.json()).then((all: Story[]) => setStory(all[i] ?? null)).catch(() => {});
  }, []);
  return story ? <WeekStory story={story} onClose={() => {}} /> : <p className="p-8">אין /preview-week.json</p>;
}
