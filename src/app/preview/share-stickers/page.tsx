'use client';

import { notFound } from 'next/navigation';
import { WorkoutShareEditor } from '@/components/share/WorkoutShareEditor';
import type { FeedItem } from '@/lib/feed/project';

// The workout share editor on a fixed run, for the stickers (screenshots). ?nogps=1
// drops the route, so the three route stickers grey out.
// Development only. In production the route does not exist.

function route(): Array<{ lat: number; lng: number }> {
  const pts: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i <= 160; i++) {
    const t = (i / 160) * Math.PI * 2;
    pts.push({ lat: 32.08 + 0.018 * Math.sin(t) + 0.004 * Math.sin(3 * t), lng: 34.78 + 0.026 * Math.cos(t) + 0.006 * Math.cos(2 * t) });
  }
  return pts;
}

function item(): FeedItem {
  const nogps = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('nogps') === '1';
  return {
    id: 'preview', type: 'activity',
    author: { athleteId: 'a', name: 'Ofer', avatarUrl: null } as never,
    body: null, media: [], payload: null, occurredAt: '2026-10-17T05:30:00Z',
    likeCount: 0, commentCount: 0, likedByMe: false, likePreview: [], commentPreview: [], canDelete: false,
    activity: {
      id: 'act', athleteId: 'a', garminActivityId: null, activityName: 'ריצת בוקר בפארק', activityType: 'running',
      startTime: '2026-10-17T05:30:00', distance: 21_100, duration: 5_640, movingDuration: 5_600, averagePace: 267,
      averageHr: 151, maxHr: 172, calories: 1_320, elevationGain: 84, locationName: null, perceivedRpe: null, perceivedFeel: null,
      routePreview: nogps ? null : route(), hasRoute: !nogps,
      paceBands: Array.from({ length: 21 }, (_, i) => 262 + ((i * 7) % 11)),
      planVerdict: null,
    } as never,
  };
}

if (typeof window !== 'undefined' && !(window as { __shareStub?: boolean }).__shareStub) {
  (window as { __shareStub?: boolean }).__shareStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewShareStickers() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <WorkoutShareEditor item={item()} onClose={() => {}} />;
}
