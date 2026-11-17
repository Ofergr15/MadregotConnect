import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// P1 #12: while viewing as somebody the profile's edit affordances must grey out
// and answer a tap with the read-only toast, not open the editor / file picker.
const src = readFileSync('src/components/profile/ProfileOverview.tsx', 'utf8');

describe('ProfileOverview in view-as mode', () => {
  it('reads the view-as read-only flag', () => {
    expect(src).toMatch(/const readOnly = useViewAsReadOnly\(\)/);
  });
  it('edit-profile button announces read-only instead of editing', () => {
    expect(src).toMatch(/onClick=\{readOnly \? announceReadOnly : onEditProfile\}/);
  });
  it('photo upload (camera badge and empty avatar) is gated', () => {
    expect(src).toMatch(/const photoTap = readOnly \? announceReadOnly : onPhotoClick/);
    expect(src).not.toMatch(/onClick=\{onPhotoClick\}/);
    expect(src).not.toMatch(/: onPhotoClick\}/);
  });
});
