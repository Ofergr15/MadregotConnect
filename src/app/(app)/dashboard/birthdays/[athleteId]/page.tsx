'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { StoryPerson } from '@/components/stories/StoryPerson';

// One birthday person (components/stories/StoryPerson — the same screen weekly and annual use).
export default function BirthdayPersonPage() {
  return <Suspense><Inner /></Suspense>;
}

function Inner() {
  const { athleteId } = useParams<{ athleteId: string }>();
  const period = useSearchParams().get('period') || '';
  return <StoryPerson feature="birthday" athleteId={athleteId} period={period} backHref="/dashboard/birthdays" />;
}
