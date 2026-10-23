'use client';

import { notFound } from 'next/navigation';
import { MediaViewer, type MediaItem } from '@/components/photos/MediaViewer';

// The one viewer on placeholders, for screenshots (mockup photos-unified-viewer, א). Development only.
// 60 items of 23.10's real session, around its first photos (kind, shot time, length), each a sky of its hour.
const SESSION: Array<{ k: 'p' | 'v'; t: string; s: number }> = [{"k":"v","t":"06:17:12","s":11},{"k":"v","t":"06:21:20","s":19},{"k":"v","t":"06:28:13","s":7},{"k":"v","t":"06:34:52","s":14},{"k":"v","t":"06:35:09","s":16},{"k":"v","t":"06:35:16","s":10},{"k":"v","t":"06:35:27","s":16},{"k":"v","t":"06:35:53","s":12},{"k":"v","t":"06:38:02","s":11},{"k":"v","t":"06:38:16","s":5},{"k":"v","t":"06:38:22","s":11},{"k":"v","t":"06:38:41","s":4},{"k":"v","t":"06:39:40","s":6},{"k":"v","t":"06:40:10","s":8},{"k":"v","t":"06:40:23","s":6},{"k":"v","t":"06:40:32","s":9},{"k":"v","t":"06:41:29","s":6},{"k":"v","t":"06:41:37","s":5},{"k":"v","t":"06:41:46","s":7},{"k":"v","t":"06:41:56","s":11},{"k":"v","t":"06:42:15","s":17},{"k":"v","t":"06:42:43","s":2},{"k":"v","t":"06:42:47","s":8},{"k":"v","t":"06:42:56","s":8},{"k":"v","t":"06:43:25","s":2},{"k":"v","t":"06:43:25","s":2},{"k":"v","t":"06:43:50","s":5},{"k":"v","t":"06:44:45","s":5},{"k":"v","t":"06:47:19","s":7},{"k":"v","t":"06:48:36","s":18},{"k":"p","t":"06:49:10","s":0},{"k":"p","t":"06:49:10","s":0},{"k":"p","t":"06:49:14","s":0},{"k":"p","t":"06:49:16","s":0},{"k":"p","t":"06:49:21","s":0},{"k":"p","t":"06:49:26","s":0},{"k":"v","t":"06:50:43","s":5},{"k":"v","t":"06:50:51","s":8},{"k":"v","t":"06:51:00","s":10},{"k":"v","t":"06:51:54","s":0},{"k":"p","t":"06:51:55","s":0},{"k":"p","t":"06:51:58","s":0},{"k":"p","t":"06:51:59","s":0},{"k":"p","t":"06:51:59","s":0},{"k":"p","t":"06:52:02","s":0},{"k":"p","t":"06:52:06","s":0},{"k":"p","t":"06:52:10","s":0},{"k":"v","t":"06:52:14","s":7},{"k":"v","t":"06:52:25","s":18},{"k":"p","t":"06:52:48","s":0},{"k":"p","t":"06:52:48","s":0},{"k":"p","t":"06:52:49","s":0},{"k":"v","t":"06:53:01","s":4},{"k":"v","t":"06:53:20","s":5},{"k":"v","t":"06:53:33","s":13},{"k":"v","t":"06:54:06","s":5},{"k":"v","t":"06:54:28","s":15},{"k":"p","t":"06:54:31","s":0},{"k":"p","t":"06:54:31","s":0},{"k":"p","t":"06:54:32","s":0}];
const sky = (t: string) => {
  const h = Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60;
  const f = Math.max(0, Math.min(1, (h - 4.8) / 1.6));
  const c = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${c(14, 140)},${c(18, 180)},${c(46, 225)})"/><stop offset="1" stop-color="rgb(${c(36, 240)},${c(30, 200)},${c(78, 150)})"/></linearGradient></defs><rect width="900" height="1200" fill="url(#g)"/></svg>`)}`;
};
const ITEMS: MediaItem[] = SESSION.map((x, k) => {
  const t = `2026-10-23T${String(Number(x.t.slice(0, 2)) - 3).padStart(2, '0')}${x.t.slice(2)}.000Z`;
  return x.k === 'p'
    ? { kind: 'photo', id: `p${k}`, thumb: sky(x.t), full: sky(x.t), w: 900, h: 1200, t }
    : { kind: 'video', id: `v${k}`, thumb: sky(x.t), poster: sky(x.t), src: null, ms: x.s * 1000, t };
});

export default function VideosPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <MediaViewer items={ITEMS} startId={ITEMS[20].id} title="ארוכה · שישי 23.10" onClose={() => {}} onShareFolder={() => {}} onCover={() => {}} />;
}
