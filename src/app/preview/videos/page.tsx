'use client';

import { notFound } from 'next/navigation';
import { VideoViewer } from '@/components/photos/VideoViewer';

// The video player on posters only, for screenshots (mockup photos-videos, 3). Development only.
const svg = (a: string, b: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#g)"/></svg>`)}`;
const VIDEOS = [['#1F4037', '#2C5364'], ['#355C7D', '#6C5B7B'], ['#C06C84', '#6C5B7B']].map(([a, b], k) => ({ id: `v${k}`, thumb: svg(a, b), poster: svg(a, b), src: null, ms: 20000 + k * 7000 }));

export default function VideosPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <VideoViewer videos={VIDEOS} index={0} title="ארוכה · שישי 23.10" onClose={() => {}} onShare={() => {}} onCover={() => {}} />;
}
