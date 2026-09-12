import { describe, it, expect } from 'vitest';
import {
  SHARE_TEMPLATE_KEYS,
  LEGACY_TEMPLATE_KEYS,
  NEW_TEMPLATE_KEYS,
  DEFAULT_SHARE_TEMPLATE,
  SHARE_ACCENT_KEYS,
  ACCENT_HEX,
  hasRouteTrace,
  supportsPhoto,
  supportsTransparent,
  templatesForActivity,
} from '@/lib/feed/share-image';

/**
 * The layouts themselves need a canvas, so what's covered here is the part that
 * decides *which* card an athlete is offered — the half that can silently take a
 * choice away from them.
 */

const withRoute = {
  routePreview: [
    { lat: 32.1, lng: 34.8 },
    { lat: 32.2, lng: 34.81 },
    { lat: 32.3, lng: 34.82 },
    { lat: 32.4, lng: 34.83 },
  ],
};
const treadmill = { routePreview: null };

describe('the share template set', () => {
  it('is the two bands and nothing else, with no duplicates', () => {
    expect(SHARE_TEMPLATE_KEYS).toHaveLength(10);
    expect(new Set(SHARE_TEMPLATE_KEYS).size).toBe(10);
    expect(SHARE_TEMPLATE_KEYS).toEqual([...NEW_TEMPLATE_KEYS, ...LEGACY_TEMPLATE_KEYS]);
  });

  it('still carries all three of the originals — the pass was a superset, not a cull', () => {
    expect(LEGACY_TEMPLATE_KEYS).toEqual(['classic', 'card', 'minimal']);
    for (const key of LEGACY_TEMPLATE_KEYS) expect(SHARE_TEMPLATE_KEYS).toContain(key);
  });

  it('opens on a view that exists', () => {
    expect(SHARE_TEMPLATE_KEYS).toContain(DEFAULT_SHARE_TEMPLATE);
  });
});

describe('hasRouteTrace', () => {
  it('needs more than a couple of points — two is a straight line, not a shape', () => {
    expect(hasRouteTrace(withRoute)).toBe(true);
    expect(hasRouteTrace(treadmill)).toBe(false);
    expect(hasRouteTrace({ routePreview: [] })).toBe(false);
    expect(hasRouteTrace({ routePreview: withRoute.routePreview.slice(0, 2) })).toBe(false);
  });
});

describe('templatesForActivity', () => {
  it('offers everything when the run has a trace', () => {
    expect(templatesForActivity(withRoute)).toEqual(SHARE_TEMPLATE_KEYS);
  });

  it('drops only the three route views for a treadmill run, keeping seven', () => {
    const left = templatesForActivity(treadmill);
    expect(left).toHaveLength(7);
    for (const gone of ['route', 'routeOnly', 'bigNumbers']) expect(left).not.toContain(gone);
  });

  it('never hides the originals — each already shrinks around a missing route', () => {
    const left = templatesForActivity(treadmill);
    for (const key of LEGACY_TEMPLATE_KEYS) expect(left).toContain(key);
  });

  it('keeps rail order, so the chips do not reshuffle between two runs', () => {
    const left = templatesForActivity(treadmill);
    expect(left).toEqual(SHARE_TEMPLATE_KEYS.filter(k => left.includes(k)));
  });
});

describe('background capability', () => {
  it('lets the photo views take a photo, and only those', () => {
    expect(SHARE_TEMPLATE_KEYS.filter(supportsPhoto)).toEqual([
      'photo',
      'classic',
      'card',
      'minimal',
    ]);
  });

  it('has no transparent variant of the one view that is defined by its background', () => {
    expect(supportsTransparent('photo')).toBe(false);
    expect(SHARE_TEMPLATE_KEYS.filter(supportsTransparent)).toHaveLength(9);
  });
});

describe('the accent', () => {
  it('is two schemes, and white is the identity', () => {
    expect(SHARE_ACCENT_KEYS).toEqual(['white', 'orange']);
    expect(ACCENT_HEX.white).toBe('#ffffff');
    expect(ACCENT_HEX.orange).toBe('#FF5315');
  });
});
