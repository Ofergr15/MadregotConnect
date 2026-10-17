import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * #113: a run on a profile opens that run (route + full numbers). The plain
 * "recent runs" list became the Activity tab — the athlete's own feed cards —
 * and a feed card is itself the doorway to the run's page.
 */
const body = readFileSync(new URL('../components/profile/AthleteProfileBody.tsx', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../components/profile/ProfileActivityFeed.tsx', import.meta.url), 'utf8');
const card = readFileSync(new URL('../components/FeedCard.tsx', import.meta.url), 'utf8');

describe('profile runs open the run', () => {
  it('the Activity tab renders the athlete\'s feed cards', () => {
    expect(body).toMatch(/section === 'activity' && athleteId && <ProfileActivityFeed/);
    expect(activity).toMatch(/<FeedCard/);
  });
  it('a feed card opens its run\'s page', () => {
    expect(card).toMatch(/router\.push\(`\/dashboard\/activities\/\$\{act\.id\}`\)/);
  });
});
