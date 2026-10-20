'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { StoryPerson } from '@/components/stories/StoryPerson';
import type { StoryFeature } from '@/lib/stories/gate';

// One person's weekly / annual story (components/stories/StoryPerson, the birthday screen's twin).
export default function StoryPersonPage() {
  return <Suspense><Inner /></Suspense>;
}

function Inner() {
  const { feature, athleteId } = useParams<{ feature: string; athleteId: string }>();
  const period = useSearchParams().get('period') || '';
  if (feature !== 'weekly' && feature !== 'annual') return null;
  return <StoryPerson feature={feature as StoryFeature} athleteId={athleteId} period={period} backHref={`/dashboard/stories/${feature}`} />;
}
