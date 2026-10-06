import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Every notification has to open the exact place it is about (2026-10-06 audit):
// these used to land on a landing screen, a disabled page, or the reader's own
// profile. Pinned at the source, since the URL is a string in each sender.
const src = (p: string) => readFileSync(p, 'utf8');

describe('notification links open the exact place', () => {
  it('watch disconnected → the data-source screen with the reconnect button', () => {
    expect(src('src/app/api/garmin/push-workouts/route.ts')).toContain("url: '/dashboard/profile?tab=datasource'");
  });
  it('shoe limit → the profile, where the shoes are', () => {
    expect(src('src/lib/shoes.ts')).not.toContain("url: '/dashboard/settings'");
  });
  it('a new perk opens that perk', () => {
    expect(src('src/app/api/admin/perks/route.ts')).toContain('/dashboard/benefits?perk=${data.id}');
  });
  it('a follow opens the follower, not your own profile', () => {
    expect(src('src/app/api/athletes/follow/route.ts')).toContain('teammateHref(followerId)');
  });
  it('nothing points at the switched-off photos page', () => {
    expect(src('src/app/api/photos/notify-import/route.ts')).not.toContain("url: '/dashboard/photos");
    expect(src('src/app/api/photos/enroll-selfie/route.ts')).not.toContain("url: '/dashboard/photos");
  });
  it('a coach message is written to the inbox too, not only pushed', () => {
    const s = src('src/app/api/workout-feedback/[id]/messages/route.ts');
    expect(s).toContain('notifyAthlete(');
    expect(s).not.toContain('sendPushLocalized(');
  });
});
