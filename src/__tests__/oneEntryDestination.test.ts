import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * ONE DESTINATION FOR "SOMEBODY IS WAITING TO GET IN" (feedback a26afd2f).
 *
 * "לפעמים אני רואה את המסך הזה ולפעמים את המסך שמראה את הגרפים של מי נמצא באיזה
 * שלב, צריך לעשות בזה סדר."
 *
 * The cause was not that two screens existed — it was that which one you got
 * depended entirely on how you arrived. Every BROWSE path (the Settings landing
 * row, Coach Tools, the athletes list) opened /dashboard/entry-queue; every ALERT
 * (the admin email, both push notifications, the home attention card) opened the
 * הרשמות list inside Settings. Same club, same count, two screens, and the split
 * ran along "did you tap the notification or go looking yourself".
 *
 * These tests pin the half of the fix that rots silently. The links are the fix:
 * a new alert wired to the old screen would reintroduce exactly the reported bug
 * and would look perfectly reasonable in review.
 */

/** Everything that tells an approver somebody is waiting. */
const ALERTS = [
  'lib/email/index.ts',
  'lib/signup-queue.ts',
  'app/api/public/signup/route.ts',
  'components/admin/AdminAttention.tsx',
  'app/(app)/dashboard/registrations/page.tsx',
];

describe('one destination for "who is waiting to get in"', () => {
  it('sends every alert to the entry queue, not to the log', () => {
    for (const rel of ALERTS) {
      const src = read(rel);
      expect(src, rel).toMatch(/\/dashboard\/entry-queue\?at=mine/);
      // The old screen is not a destination for anything that fires by itself.
      expect(src, rel).not.toMatch(/dashboard\/settings\?tab=registrations/);
    }
  });

  it('keeps /dashboard/registrations working, pointed at the queue', () => {
    // Mail already sitting in an inbox uses this URL, so it may not 404 — it just
    // may not land on a different screen than every other path does.
    const src = read('app/(app)/dashboard/registrations/page.tsx');
    expect(src).toMatch(/redirect\('\/dashboard\/entry-queue\?at=mine'\)/);
  });

  it('leaves exactly one way to the log, and it is a deliberate one', () => {
    // Two: the bottom of the entry queue, and the Coach Tools row that now says
    // "log" instead of "הרשמות" (it used to sit directly under the entry-queue row
    // reading as the same thing). Settings renders it; it does not link to it.
    const queue = read('app/(app)/dashboard/entry-queue/page.tsx');
    expect(queue).toMatch(/href="\/dashboard\/settings\?tab=registrations"/);
    expect(queue).toMatch(/t\('openLog'\)/);
    const tools = read('app/(app)/dashboard/coach-tools/page.tsx');
    expect(tools).toMatch(/ts\('registrationLog'\)/);
    expect(tools).not.toMatch(/ts\('registrations'\)/);
  });

  it('carries the duplicate warning to where the approve button is', () => {
    // The warning that exists because six duplicate members were created used to
    // sit on the הרשמות row, next to that screen's approve button. The approving
    // now happens on the entry queue, so the warning had to come along — and the
    // EMPTY case has to be stated, which is the case that produced the last one.
    const route = read('app/api/admin/entry-queue/route.ts');
    expect(route).toMatch(/const unplaced = !approved && isSyntheticAuthEmail\(email\)/);
    expect(route).toMatch(/rankAthleteCandidates\(roster\.filter\(\(r\) => r\.id !== id\)/);
    const queue = read('app/(app)/dashboard/entry-queue/page.tsx');
    expect(queue).toMatch(/\{m\.unplaced && \(/);
    expect(queue).toMatch(/t\('dupNone'\)/);
    expect(queue).toMatch(/dupConfidence_\$\{c\.confidence\}/);
  });

  it('names the log a log in both catalogues, on both screens', () => {
    for (const f of ['../messages/he.json', '../messages/en.json']) {
      const m = JSON.parse(read(f));
      for (const k of ['openLog', 'openLogHint', 'dupHeading', 'dupHint', 'dupNone',
        'dupConfidence_exact', 'dupConfidence_near', 'dupConfidence_weak']) {
        expect(m.entryQueue[k], `${f} entryQueue.${k}`).toBeTruthy();
      }
      expect(m.settings.registrationLog, f).toBeTruthy();
    }
    // The screen's own title, which used to be "בקשות הרשמה" — the same words the
    // entry queue's job is described in.
    expect(read('components/RegistrationsQueue.tsx')).toMatch(/יומן ההרשמות/);
  });
});
