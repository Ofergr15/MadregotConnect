'use client';

import { notFound } from 'next/navigation';
import BirthdaysPage from '@/app/(app)/dashboard/birthdays/page';

// The admin "ימי הולדת" screen on a stubbed list (screenshots). Development only.

const LIST = {
  today: '2026-10-18', sending: false,
  rows: [
    { athleteId: 'a1', name: 'Shalev Bahalul', avatarUrl: null, birthday: '2026-10-18', inDays: 0, config: { displayName: 'שלו', message: 'הקמת את המדרגות, ואתה זה שמחזיק את כל הצד המקצועי שלה.', momentTitle: 'מרתון ברלין', momentSeconds: 9108, photos: { intro: '/pv/sh3563.jpg', km: '/pv/sh3564.jpg', moment: '/pv/berlin.jpg' } } },
    { athleteId: 'a2', name: 'Netanel Winer', avatarUrl: null, birthday: '2026-11-05', inDays: 18, config: {} },
  ],
};

if (typeof window !== 'undefined' && !(window as { __bdStub?: boolean }).__bdStub) {
  (window as { __bdStub?: boolean }).__bdStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/admin/birthdays')) return new Response(JSON.stringify(init?.method === 'PUT' ? { config: {} } : LIST), { status: 200, headers: { 'content-type': 'application/json' } });
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewBirthdaysAdmin() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <BirthdaysPage />;
}
