import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

/**
 * The profile's Activity tab reads GET /api/feed?athlete=<id>: one athlete's own
 * items, on their profile or a teammate's. It may only NARROW the club feed —
 * the id is validated, and the pending-author filter still runs after it, so an
 * unapproved runner stays as invisible here as on the feed.
 */

const ROUTE = readFileSync('src/app/api/feed/route.ts', 'utf8');
const CLIENT = readFileSync('src/lib/feed-client.ts', 'utf8');

describe('the feed\'s athlete filter', () => {
  it('rejects anything that is not a uuid before it reaches the query', () => {
    expect(ROUTE).toMatch(/if \(athleteParam && !UUID_RE\.test\(athleteParam\)\)[\s\S]*?status: 400/);
  });

  it('narrows to that one author, ahead of any squad', () => {
    expect(ROUTE).toMatch(/let squadAuthorIds: string\[\] \| null = athleteParam \? \[athleteParam\] : null;/);
    expect(ROUTE).toMatch(/if \(athleteParam\) \{[\s\S]*?\} else if \(squad\?\.kind === 'mine'\)/);
  });

  it('still drops pending authors afterwards', () => {
    const narrow = ROUTE.indexOf("query = query.in('author_athlete_id', squadAuthorIds)");
    const pending = ROUTE.indexOf('withoutPendingAuthors(');
    expect(narrow).toBeGreaterThan(0);
    expect(pending).toBeGreaterThan(narrow);
  });

  it('is sent by the client as ?athlete=', () => {
    expect(CLIENT).toMatch(/if \(athlete\) qs\.set\('athlete', athlete\);/);
  });
});
