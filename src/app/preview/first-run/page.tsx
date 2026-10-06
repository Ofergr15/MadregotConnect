'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { FirstRunFlow, type Stage } from '@/components/onboarding/FirstRunFlow';

// Login-free preview of the first-run sequence: ?s=welcome|push|pushDone|pushBlocked. Development only.
export default function FirstRunPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [s, setS] = useState<Stage | null>(null);
  useEffect(() => setS((new URLSearchParams(window.location.search).get('s') as Stage) || 'welcome'), []);
  return s ? <FirstRunFlow previewStage={s} /> : null;
}
