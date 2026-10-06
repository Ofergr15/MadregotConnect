import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { smoothRoute } from '@/lib/feed/share-image';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the share card route', () => {
  it('smooths the jitter but keeps both ends where they were', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 3 }, { x: 2, y: 0 }, { x: 3, y: 3 }];
    const out = smoothRoute(pts);
    expect(out[0]).toEqual(pts[0]);
    expect(out[3]).toEqual(pts[3]);
    expect(out[1]).toEqual({ x: 1, y: 1 });
  });

  it('is drawn thin over a casing, with no blur', () => {
    const src = read('lib/feed/share-image.ts');
    const fn = src.slice(src.indexOf('function drawRoute('), src.indexOf('interface Stat {'));
    expect(fn).toMatch(/if \(!FULL_TRACKS\.has\(points\)\) \{\s+drawRouteClassic/);
    expect(fn).toMatch(/traceCurve\(ctx, pts\)/);
    expect(read('lib/share/full-route.ts')).toMatch(/const wants = !!item\?\.activity\?\.routePreview\?\.length/);
  });

  it('the card uses the whole track when the sheet fetched it, and only an unmasked route gets one', () => {
    expect(read('lib/feed/share-image.ts')).toMatch(/raw\.routeFull && raw\.routeFull\.length > \(raw\.routePreview\?\.length \?\? 0\)/);
    const api = read('app/api/feed/items/[id]/route.ts');
    expect(api).toMatch(/searchParams\.get\('route'\) === 'full' && item\.activity\?\.routePreview\?\.length/);
    expect(read('components/ShareSheet.tsx')).toMatch(/useFullRoute\(given\.kind === 'workout' \? given\.item : null\)/);
  });
});
