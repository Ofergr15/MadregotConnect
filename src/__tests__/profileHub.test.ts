import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The profile redesign (mockups/profile-hub/v2-real-app.html, approved 2026-10-17):
// open on the athlete's own feed, four tabs, every setting in the owner's last one.
const body = readFileSync('src/components/profile/AthleteProfileBody.tsx', 'utf8');
const page = readFileSync('src/app/(app)/dashboard/profile/page.tsx', 'utf8');
const peer = readFileSync('src/app/(app)/dashboard/teammate/[id]/page.tsx', 'utf8');
const badges = readFileSync('src/app/api/athletes/badges/route.ts', 'utf8');

describe('the profile', () => {
  it('opens on Activity — the athlete\'s own feed', () => {
    expect(body).toMatch(/useState<ProfileSection>\('activity'\)/);
    expect(body).toMatch(/section === 'activity' && athleteId && <ProfileActivityFeed/);
  });

  it('has a settings tab only when the owner hands it settings', () => {
    expect(body).toMatch(/\.\.\.\(settingsSlot \? \[\['settings', t\('tabSettings'\)\]\] : \[\]\)/);
    expect(page).toMatch(/settingsSlot=\{/);
    expect(peer).not.toMatch(/settingsSlot/);
  });

  it('keeps the badges under the records, for everyone', () => {
    expect(body).toMatch(/<BadgesGrid athleteId=\{athleteId\} peer=\{!owner\} \/>/);
    // …which means a teammate must be able to read them: member gate, not owner-only.
    expect(badges).not.toMatch(/mayActFor/);
    expect(badges).toMatch(/isPendingAthlete/);
  });

  it('shows "needs attention" only when something is broken', () => {
    expect(page).toMatch(/\{\(pushDead \|\| connectionBroken\) && \(/);
  });

  it('asks the club to delete an account rather than deleting it', () => {
    expect(page).toMatch(/fetch\('\/api\/feedback'/);
    expect(page).toMatch(/kind: 'delete-account'/);
  });

  it('is one header for both — yours and a teammate\'s', () => {
    expect(readFileSync('src/components/profile/ProfileOverview.tsx', 'utf8')).toMatch(/<ProfileHero/);
    expect(peer).toMatch(/<ProfileHero/);
  });
});
