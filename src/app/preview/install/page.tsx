'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { InstallGuide } from '@/components/install/InstallGuide';
import type { InstallPlatform } from '@/lib/install/platform';

// ── Login-free preview of the install guide ──────────────────────────────────
// `?p=` picks the platform (ios-safari, ios-safari-26, ios-inapp, android,
// android-inapp, desktop), `?video=1` opens on the video, `?prompt=1` pretends
// Chrome offered its install button. Development only.

export default function InstallGuidePreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => setQ(new URLSearchParams(window.location.search)), []);
  if (!q) return null;
  return (
    <InstallGuide
      forcePlatform={(q.get('p') as InstallPlatform) || 'ios-safari'}
      forceVideo={q.get('video') === '1'}
      canPrompt={q.get('prompt') === '1'}
      onInstall={async () => {}}
      onLater={() => {}}
      onNever={() => {}}
      memberName="נועה"
    />
  );
}
