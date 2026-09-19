import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * 828aaf40 — "after I go into a profile and tap a user's photo, the exit button
 * doesn't work. There is an X but it doesn't respond."
 *
 * It responded. It closed the lightbox and then the same click re-opened it.
 * `createPortal` relocates the DOM node to document.body but leaves the element
 * where it is in the REACT tree, and React events bubble along the React tree —
 * so while FeedAvatar rendered the lightbox inside the div carrying
 * `onClick: setEnlarged(true)`, every tap inside the overlay reached that
 * handler. Nothing looked broken in the DOM and nothing threw; the overlay just
 * never went away.
 *
 * Both halves are pinned because either one alone fixes it, and a fix that
 * depends on a caller's JSX nesting is the bug waiting to come back.
 */

describe('the lightbox can be closed', () => {
  const lightbox = read('components/PhotoLightbox.tsx');

  it('stops the closing click instead of letting it reach whatever opened it', () => {
    expect(lightbox).toMatch(/const close = \(e: React\.MouseEvent\) => \{/);
    const body = lightbox.match(/const close = [\s\S]*?\n  \};/)![0];
    expect(body.indexOf('e.stopPropagation()')).toBeLessThan(body.indexOf('onClose()'));
  });

  it('uses it for both ways out — the X and the backdrop', () => {
    // The backdrop tap had exactly the same problem as the button; fixing only
    // the one in the report would have left the overlay half-stuck.
    expect(lightbox).toMatch(/onClick=\{close\}\s*\n\s*className="fixed inset-0/);
    expect(lightbox.match(/onClick=\{close\}/g)).toHaveLength(2);
    // And a raw onClose on a handler would reintroduce it.
    expect(lightbox).not.toMatch(/onClick=\{onClose\}/);
  });

  it('keeps the photo itself out of the close targets', () => {
    // Pinching to zoom starts with a touch on the image.
    expect(lightbox).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  it('still closes on Escape', () => {
    expect(lightbox).toMatch(/e\.key === 'Escape'/);
  });

  it('announces the X as a close button, not as the person', () => {
    // `alt` is the athlete's name and labels the DIALOG. It was on the button too.
    expect(lightbox).toMatch(/aria-label=\{tCommon\('close'\)\}/);
  });
});

describe('FeedAvatar renders the lightbox as a sibling', () => {
  const avatar = read('components/FeedAvatar.tsx');

  it('puts it outside the element that opens it', () => {
    const portalAt = avatar.indexOf('<PhotoLightbox');
    const openerAt = avatar.indexOf('onClick: () => setEnlarged(true)');
    expect(portalAt).toBeGreaterThan(-1);
    expect(openerAt).toBeGreaterThan(-1);
    expect(portalAt).toBeLessThan(openerAt);
    // Specifically: before the circle's own <div opens, not merely earlier in the file.
    expect(portalAt).toBeLessThan(avatar.indexOf('rounded-full bg-brand-600/10'));
  });

  it('wraps in a fragment so nobody’s layout moves', () => {
    // Every caller sizes this component from the outside; a real wrapper element
    // would land between their flex container and the circle.
    expect(avatar).toMatch(/return \(\s*\n\s*<>/);
  });

  it('offers the tap only when there is a photo to enlarge', () => {
    // Two initials are nothing to look at, and a tap that sometimes does nothing
    // is worse than one that never does.
    expect(avatar).toMatch(/const canEnlarge = enlargeable && showImage/);
    expect(avatar).toMatch(/canEnlarge && enlarged && url &&/);
  });
});

describe('the other call site was already right', () => {
  it('ProfileOverview keeps the lightbox beside the button, not inside it', () => {
    const overview = read('components/profile/ProfileOverview.tsx');
    const portalAt = overview.indexOf('<PhotoLightbox');
    const buttonAt = overview.indexOf('onClick={avatarUrl ? () => setPhotoOpen(true)');
    expect(portalAt).toBeGreaterThan(-1);
    expect(portalAt).toBeLessThan(buttonAt);
  });
});
