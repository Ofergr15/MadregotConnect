import { describe, expect, it } from 'vitest';
import { MAX_POINTS, parseCourseGpx } from '@/lib/events/course-gpx';

/** Parse-only course geometry. Synthetic coordinates on the equator — NOT the Valencia course. */

const gpx = (pts: string, extra = '') => `<?xml version="1.0"?><gpx version="1.1" creator="test">${extra}<trk><name>Synthetic loop</name><trkseg>${pts}</trkseg></trk></gpx>`;
const trk = (lat: number, lng: number) => `<trkpt lat="${lat}" lon="${lng}"><ele>10</ele></trkpt>`;
// 0.01° of longitude on the equator ≈ 1112 m.
const line = (n: number, step = 0.01) => Array.from({ length: n }, (_, i) => trk(0, i * step)).join('');

describe('parseCourseGpx', () => {
  it('reads a track: points, distance, start/finish, bounds, name', () => {
    const r = parseCourseGpx(gpx(line(11)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.course.points).toHaveLength(11);
    expect(r.course.distanceM).toBeGreaterThan(11_100);
    expect(r.course.distanceM).toBeLessThan(11_150);
    expect(r.course.start).toEqual({ lat: 0, lng: 0 });
    expect(r.course.finish).toEqual({ lat: 0, lng: 0.1 });
    expect(r.course.bounds).toEqual({ south: 0, west: 0, north: 0, east: 0.1 });
    expect(r.course.name).toBe('Synthetic loop');
  });
  it('a route file (rtept) works; a track wins when both exist', () => {
    const rte = `<gpx><rte><rtept lat="1" lon="1"/><rtept lat="1" lon="1.01"/></rte></gpx>`;
    expect(parseCourseGpx(rte)).toMatchObject({ ok: true, course: { sourcePoints: 2 } });
    const both = `<gpx><rte><rtept lat="5" lon="5"/><rtept lat="5" lon="6"/></rte><trk><trkseg>${line(3)}</trkseg></trk></gpx>`;
    const r = parseCourseGpx(both);
    expect(r.ok && r.course.start).toEqual({ lat: 0, lng: 0 });
  });
  it('accepts single quotes and attribute order lon-before-lat', () => {
    const r = parseCourseGpx(`<gpx><trk><trkseg><trkpt lon='2' lat='1'/><trkpt lon='2.01' lat='1'/></trkseg></trk></gpx>`);
    expect(r.ok && r.course.start).toEqual({ lat: 1, lng: 2 });
  });
  it('thins a long track to ≤ MAX_POINTS, keeps the finish, measures distance on every point', () => {
    const n = MAX_POINTS * 3 + 7;
    const r = parseCourseGpx(gpx(line(n, 0.0001)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.course.points.length).toBeLessThanOrEqual(MAX_POINTS + 1);
    expect(r.course.points.at(-1)).toEqual(r.course.finish);
    expect(r.course.sourcePoints).toBe(n);
    expect(r.course.distanceM).toBe(Math.round((n - 1) * 11.1195));
  });
  it('refuses DOCTYPE/ENTITY (no entity expansion), non-GPX, too few points, bad coordinates, oversize', () => {
    expect(parseCourseGpx(`<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x "y">]>${gpx(line(3))}`)).toEqual({ ok: false, error: 'doctype' });
    expect(parseCourseGpx('<kml><Placemark/></kml>')).toEqual({ ok: false, error: 'not_gpx' });
    expect(parseCourseGpx(gpx(trk(0, 0)))).toEqual({ ok: false, error: 'too_few_points' });
    expect(parseCourseGpx(gpx(trk(0, 0) + trk(91, 0)))).toEqual({ ok: false, error: 'bad_coordinate' });
    expect(parseCourseGpx(gpx(trk(0, 0) + '<trkpt lat="x" lon="1"/>'))).toEqual({ ok: false, error: 'bad_coordinate' });
    expect(parseCourseGpx('<gpx>' + ' '.repeat(5_000_001))).toEqual({ ok: false, error: 'too_large' });
  });
});
