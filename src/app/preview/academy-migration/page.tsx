'use client';

import { notFound } from 'next/navigation';
import { MigrationBoard } from '@/components/academy/MigrationBoard';
import { MigrationEntry } from '@/components/academy/MigrationEntry';

// The move-in board ("מעבר האקדמיה") on a stubbed fetch: one of each state.
// ?entry=1 shows the People-tab entry row instead of the board.
// Development only. In production the route does not exist.

const row = (athleteId: string, name: string, at: number, step: string, owner: string | null, days: number | null, stuck: boolean, inviteUrl: string | null = null) =>
  ({ athleteId, name, at, step, owner, daysSinceMove: days, stuck, avatarUrl: null, phone: '0501234567', email: 'x@example.com', inviteUrl });

const BOARD = {
  today: '2026-10-17',
  summary: { done: 2, onTheWay: 3, stuck: 2 },
  rows: [
    row('a1', 'נתנאל כהן', 1, 'joined', 'trainee', 8, true, 'https://www.madregot.app/join/abc'),
    row('a2', 'שחר לוי', 2, 'watch', 'trainee', 6, true),
    row('a3', 'איילון ברק', 3, 'test', 'coach', 3, false),
    row('a4', 'דנה מזרחי', 4, 'questions', 'trainee', 2, false),
    row('a5', 'אלדר פרץ', 5, 'firstWeek', 'coach', 4, false),
    row('a6', 'עופר גרוספלד', 6, 'done', null, 11, false),
    row('a7', 'יעל שמש', 6, 'done', null, 9, false),
  ],
};

if (typeof window !== 'undefined' && !(window as { __migStub?: boolean }).__migStub) {
  (window as { __migStub?: boolean }).__migStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/academy/migration/remind')) return new Response(JSON.stringify({ reminded: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('/api/')) return new Response(JSON.stringify(BOARD), { status: 200, headers: { 'content-type': 'application/json' } });
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewAcademyMigration() {
  if (process.env.NODE_ENV === 'production') notFound();
  const entry = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('entry') === '1';
  return (
    <div className="min-h-[100dvh] bg-page p-4 pt-14" dir="rtl">
      {entry ? <MigrationEntry onOpen={() => {}} /> : <MigrationBoard onClose={() => {}} onSelect={() => {}} />}
    </div>
  );
}
