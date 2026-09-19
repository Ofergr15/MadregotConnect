'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import type { LinkableAthlete, LinkableCandidate } from '@/lib/academy/link';
import { LinkAthleteSheet } from '@/components/academy/LinkAthleteSheet';

// ── Login-free preview of the account-linking sheet ──────────────────────────
//
// The suggestions below come from the REAL `suggestAthleteLinks`, so which row is
// first, which badge it carries and which row is refused are all the shipped
// verdicts. A preview of a ranked list is only worth auditing on that condition:
// a row in the wrong place here is a bug and not a fixture typo.
//
// Deterministic, like every preview in this directory: every date is counted back
// from the Israel calendar day, never from `Date.now()` at module scope.
//
// Development only. In production the route does not exist.

const DAY = 24 * 3_600_000;

/** An instant `daysAgo` before today's Israel morning. */
function at(daysAgo: number): string {
  const day = israelToday(new Date(Date.parse(israelToday()) - daysAgo * DAY));
  return new Date(`${day}T09:00:00+03:00`).toISOString();
}

// The characterization call was five days ago, which is what "registered around then" is
// measured against.
const CALL = at(5);

const CANDIDATE: LinkableCandidate = {
  id: 'c1',
  name: 'אבי ברק',
  email: 'avi.barak@example.com',
  phone: '050-123-4567',
};

/**
 * A roster that exercises each rung of the ladder at once:
 *
 *  - `avi` is an exact email match, and the account the candidate actually registered.
 *  - `dana` matches the candidate's phone — and belongs to ANOTHER candidate, so the row has
 *    to be visible, refused, and explained. That combination is also the real signal it stands
 *    for: one contact detail across two candidate rows means two rows for one person.
 *  - `noa` and `ron` only registered around the right time. Weak, and `noa` is ahead because
 *    she came through `/academy-register` even though `ron` registered a day closer.
 *  - `yossi` is from another season and must not appear at all.
 *  - `tamar` has a fabricated Strava address, which must never be shown as an email.
 */
const ROSTER: LinkableAthlete[] = [
  { id: 'yossi', name: 'Yossi Adler', email: 'yossi@example.com', createdAt: at(400) },
  { id: 'ron', name: 'Ron Shemesh', email: 'ron@example.com', createdAt: at(4) },
  { id: 'avi', name: 'Avi Barak', email: 'avi.barak@example.com', isAcademy: true, createdAt: at(3) },
  { id: 'noa', name: 'Noa Peretz', email: 'noa@example.com', isAcademy: true, createdAt: at(11) },
  { id: 'dana', name: 'Dana Cohen', email: 'dana@example.com', phone: '+972501234567', createdAt: at(60) },
  { id: 'tamar', name: 'Tamar Aviv', email: 'strava_77@strava.madregot.local', createdAt: at(9) },
];

/** `dana` is spoken for. The partial unique index on `athlete_id` is what this stands in for. */
const TAKEN_BY = { dana: 'another-candidate' };

export default function AcademyLinkPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  // The query string chooses the state, so several audit entries can shoot the same page
  // without one navigation interrupting the next. Read in an effect and never in the
  // `useState` initializer — the initializer runs on the server too, where `window` does not
  // exist, and the resulting hydration mismatch makes React discard the tree.
  const [mode, setMode] = useState<'suggest' | 'linked' | 'none' | 'failed'>('suggest');
  useEffect(() => {
    const q = window.location.search;
    if (q.includes('linked')) setMode('linked');
    else if (q.includes('none')) setMode('none');
    else if (q.includes('failed')) setMode('failed');
  }, []);

  // Day one: nobody has registered yet, so there is nothing to link and the sheet has to say
  // WHICH of the two it is rather than looking broken.
  const athletes = mode === 'none' ? [] : ROSTER;
  const linked = mode === 'linked' ? ROSTER.find(a => a.id === 'avi')! : null;

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-ink-900">חיבור לחשבון</h1>
        <p className="text-xs text-ink-400">תצוגה מקדימה · נתוני דמה</p>
      </div>
      <LinkAthleteSheet
        open
        onOpenChange={() => undefined}
        candidate={linked ? { ...CANDIDATE, athleteId: linked.id } : CANDIDATE}
        athletes={athletes}
        takenBy={TAKEN_BY}
        since={CALL}
        linkedAthlete={linked}
        onLink={() => undefined}
        onUnlink={() => undefined}
        loadFailed={mode === 'failed'}
      />
    </div>
  );
}
