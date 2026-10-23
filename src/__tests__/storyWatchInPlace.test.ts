import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Ofer, 2026-10-23, on the operator account: "I don't see the weekly story". The admin
// screens linked to /feed?weekStory=1…, and /feed sends the operator account home
// (it has no member feed), so the story never opened. These pin the two fixes.
const read = (p: string) => readFileSync(p, 'utf8');

describe('watching the weekly story from the stories admin screens', () => {
  it('the person screen opens the story right there, not by sending the admin to the feed', () => {
    const src = read('src/components/stories/StoryPerson.tsx');
    expect(src).toMatch(/<WatchWeekStory athleteId=\{athleteId\}/);
    expect(src).not.toMatch(/href=\{`\/feed\?weekStory=1/);
  });
  it('the weekly screen: ▶ on every receiver and tester row, and "תצוגה" opens a real person\'s story', () => {
    const page = read('src/app/(app)/dashboard/stories/[feature]/page.tsx');
    expect(page).toMatch(/onWatch=\{f === 'weekly' \? \(r\) => setWatch\(r\.athleteId\)/);
    expect(page).toMatch(/onWatch=\{f === 'weekly' \? setWatch : undefined\}/);
    expect(page).toMatch(/previewWho/);
    const admin = read('src/components/stories/StoryAdmin.tsx');
    expect(admin).toMatch(/function PlayButton/);
  });
  it('the viewer asks for that person as of the coming Saturday', () => {
    const src = read('src/components/stories/WatchWeekStory.tsx');
    expect(src).toMatch(/\/api\/week-story\?at=\$\{at\}&athleteId=\$\{encodeURIComponent\(athleteId\)\}/);
  });
  it('/feed keeps a story deep link for the operator instead of sending it home', () => {
    const src = read('src/app/(app)/feed/page.tsx');
    expect(src).toMatch(/if \(isOperator && !storyLink\) router\.replace\('\/dashboard'\)/);
  });
});
