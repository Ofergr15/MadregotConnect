'use client';

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { YearStory } from '@/components/birthday/YearStory';
import type { BirthdayStory } from '@/lib/birthday-year/server';

// The birthday story on a story read from /preview-birthday.json (a local file, never
// committed — it is one person's real year). Development only.

export default function PreviewBirthdayYear() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [story, setStory] = useState<BirthdayStory | null>(null);
  useEffect(() => { fetch(`/preview-birthday${new URLSearchParams(window.location.search).get('f') ? '-' + new URLSearchParams(window.location.search).get('f') : ''}.json`).then((r) => r.json()).then(setStory).catch(() => {}); }, []);
  return story ? <YearStory story={story} onClose={() => {}} /> : <p className="p-8">אין /preview-birthday.json</p>;
}
