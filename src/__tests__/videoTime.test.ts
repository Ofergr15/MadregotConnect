import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
const { exifToIso, headerTime, mvhdTime, textDateTime, timeFromName, trustedNameTime } = await import('@/lib/photos/video-time');

// When a video was shot (Ofer, 2026-10-23): Drive's dates are the upload; the name or the
// file's own header has the moment, and photos and videos then share one clock.
const box = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(body, 8);
  return out;
};
const cat = (...parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const QT = 2_082_844_800;
const mvhd = (unix: number, version: 0 | 1 = 0) => {
  const body = new Uint8Array(version ? 32 : 20);
  const dv = new DataView(body.buffer);
  body[0] = version;
  if (version) { dv.setUint32(4, 0); dv.setUint32(8, unix + QT); } else dv.setUint32(4, unix + QT);
  return box('mvhd', body);
};
// An iPhone .mov: ftyp, then the media, then moov (with mvhd) at the end.
const shot = Date.UTC(2026, 9, 23, 2, 23, 26) / 1000;
const file = cat(box('ftyp', new Uint8Array(12)), box('wide', new Uint8Array(0)), box('mdat', new Uint8Array(5000)), box('moov', cat(mvhd(shot), box('trak', new Uint8Array(40)))));
const reader = (bytes: Uint8Array) => { let reads = 0; const r = async (s: number, l: number) => { reads++; return bytes.slice(s, s + l); }; return { r, reads: () => reads }; };

describe('the shot time of a video', () => {
  it('from the header, wherever moov is, reading only the headers and moov', async () => {
    const { r, reads } = reader(file);
    expect(await headerTime(r)).toBe('2026-10-23T02:23:26.000Z');
    expect(reads()).toBe(5);
  });
  it('a 64-bit mvhd, and a camera with no clock (1904) is not a time', () => {
    expect(mvhdTime(box('moov', mvhd(shot, 1)))).toBe('2026-10-23T02:23:26.000Z');
    expect(mvhdTime(box('moov', mvhd(-QT)))).toBeNull();
  });
  it('from the name, in Israel time', () => {
    expect(timeFromName('VID_20261020_075416_00_284.mp4')).toBe('2026-10-20T04:54:16.000Z');
    expect(timeFromName('PXL_20261016_083517123.mp4')).toBe('2026-10-16T05:35:17.000Z');
    expect(timeFromName('IMG_3668.MOV')).toBeNull();
  });
  it('a photo\'s EXIF wall clock and a video\'s instant compare on one line', () => {
    expect(exifToIso('2026:10:23 06:55:41')).toBe('2026-10-23T03:55:41.000Z');
    expect(exifToIso('2026-10-23T02:23:26.000Z')).toBe('2026-10-23T02:23:26.000Z');
    expect(exifToIso(null)).toBeNull();
  });
});

describe('an Insta360 export (23.10: shot in the dark at 05:03, named 09:14 when exported)', () => {
  it('its name is not trusted ahead of the header, only as the fallback', () => {
    expect(trustedNameTime('VID_20261023_091420_00_125.mp4')).toBeNull();
    expect(timeFromName('VID_20261023_091420_00_125.mp4')).toBe('2026-10-23T06:14:20.000Z');
    expect(trustedNameTime('PXL_20261016_083517123.mp4')).toBe('2026-10-16T05:35:17.000Z');
  });
  it('the header text date is the camera wall clock in Israel, despite its +0000', () => {
    const moov = new Uint8Array(Buffer.from('....moov....Insta360\u00002026-10-23 05:03:27 +0000\u0000', 'latin1'));
    expect(textDateTime(moov)).toBe('2026-10-23T02:03:27.000Z');
    expect(textDateTime(new Uint8Array(Buffer.from('no date here', 'latin1')))).toBeNull();
  });
});
