import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { PHOTOS_STORY_LABEL, photosFolderHref } from '@/lib/feed/club-stories';

// Ofer, 2026-10-23: the "photos are up" message in the Madregot circle had no way to the
// photos, and nothing under the circle said what it was. And the folders' settings are
// the admin's.
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('the photos message in the circle', () => {
  it('goes to the session\'s folder, and says it is photos', () => {
    expect(photosFolderHref('abc')).toBe('/dashboard/photos?folder=abc');
    const server = read('src/lib/quality-session/photos-server.ts');
    expect(server).toMatch(/href: folderId \? photosFolderHref\(folderId\) : `\/feed\?item=\$\{out\.id\}`, label: PHOTOS_STORY_LABEL/);
    expect(PHOTOS_STORY_LABEL).toBe('📸 תמונות');
  });
  it('one posted before the link existed gets it from the ledger', () => {
    expect(read('src/app/api/feed/celebrations/route.ts')).toMatch(/withPhotoLinks\(supabase, activeClubStories/);
  });
  it('the sheet has the button, the circle the label', () => {
    const ui = read('src/components/feed/CelebrationStories.tsx');
    expect(ui).toMatch(/'לתמונות ›'/);
    expect(ui).toMatch(/\{label \|\| 'הודעה'\}/);
  });
});

describe('the folders\' settings', () => {
  it('are the admin\'s, on the server and on the screen', () => {
    expect(read('src/app/api/photos/folder-meta/route.ts')).toMatch(/!auth\.user\.isSuperUser && !hasRole\(auth\.user, 'admin'\)/);
    const page = read('src/app/(app)/dashboard/photos/page.tsx');
    expect(page).toMatch(/const staff = effectiveRole === 'admin';/);
    expect(page).toMatch(/const coverMode = params\.get\('cover'\) === '1' && viewRole === 'admin';/);
  });
});
