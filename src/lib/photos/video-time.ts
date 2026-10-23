import { createServerClient } from '@/lib/supabase/server';
import { israelWallToUtc } from '@/lib/notifications/scheduling';

/**
 * WHEN A VIDEO WAS SHOT (Ofer, 2026-10-23: "the photos and the videos in order by date —
 * the iPhone keeps when it was taken, check").
 *
 * Drive's createdTime / modifiedTime on a video are the UPLOAD (the whole of 23.10's 158
 * videos: 04:53→09:12 UTC, in upload order). The real moment is in one of two places:
 *  - the name, for the cameras that write it there: "VID_20261020_075416_00_284.mp4",
 *    "PXL_20261016_083517123.mp4" — Israel wall-clock time;
 *  - the file's own header for everything else (an iPhone's IMG_3668.MOV): the QuickTime
 *    'mvhd' box holds its creation time, in UTC. Only that box is read, by range — a few
 *    KB of a 279 MB file — by the photo copy job (lib/photos/mirror), once per video, and
 *    the answer kept in TIMES_PATH. The listing then sorts by it.
 */

export const TIMES_PATH = 'video-times.json';
const BUCKET = 'club-photos';
/** Seconds between 1904-01-01 (QuickTime's epoch) and 1970-01-01. */
const QT_EPOCH = 2_082_844_800;

/** The capture time a camera wrote into the file name, as an ISO instant; null if none. */
export function timeFromName(name: string | null | undefined): string | null {
  const m = /(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/.exec(name || '');
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return new Date(israelWallToUtc(y, mo, d, h, mi, s)).toISOString();
}

/** A photo's EXIF time ("2026:10:23 06:55:41", the camera's wall clock in Israel) as an ISO instant. */
export function exifToIso(at: string | null | undefined): string | null {
  if (!at) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(at);
  if (!m) return Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(israelWallToUtc(y, mo, d, h, mi, s)).toISOString();
}

type Reader = (start: number, length: number) => Promise<Uint8Array | null>;

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const typeAt = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** The 'mvhd' creation time inside a 'moov' box's bytes, as an ISO instant. */
export function mvhdTime(moov: Uint8Array): string | null {
  let o = 8;
  while (o + 8 <= moov.length) {
    const size = u32(moov, o);
    if (typeAt(moov, o + 4) === 'mvhd') {
      const v = moov[o + 8];
      const secs = v === 1 ? u64(moov, o + 12) : u32(moov, o + 12);
      const ms = (secs - QT_EPOCH) * 1000;
      // A camera with no clock writes 0 (1904): not a time.
      return ms > Date.UTC(2010, 0, 1) && ms < Date.UTC(2100, 0, 1) ? new Date(ms).toISOString() : null;
    }
    if (size < 8) return null;
    o += size;
  }
  return null;
}

/**
 * Walk the file's top-level boxes by their headers — 16 bytes each — to the 'moov' box,
 * wherever it is (an iPhone puts it after the media), then read only that box.
 */
export async function headerTime(read: Reader): Promise<string | null> {
  let pos = 0;
  for (let n = 0; n < 24; n++) {
    const h = await read(pos, 16);
    if (!h || h.length < 8) return null;
    let size = u32(h, 0);
    const type = typeAt(h, 4);
    if (size === 1) size = u64(h, 8);
    if (type === 'moov') {
      if (size < 16 || size > 8_000_000) return null;
      const moov = await read(pos, size);
      return moov ? mvhdTime(moov) : null;
    }
    if (size < 8) return null; // 0 = "to the end of the file": no moov after it
    pos += size;
  }
  return null;
}

/** What is known so far: id → ISO, or '' for "looked, found nothing". */
export async function readVideoTimes(): Promise<Record<string, string>> {
  const { data } = await createServerClient().storage.from(BUCKET).download(TIMES_PATH);
  if (!data) return {};
  try { return JSON.parse(await data.text()) as Record<string, string>; } catch { return {}; }
}

export async function writeVideoTimes(times: Record<string, string>): Promise<void> {
  await createServerClient().storage.from(BUCKET).upload(TIMES_PATH, JSON.stringify(times), { contentType: 'application/json', upsert: true });
}

/**
 * Read the shot time of the videos that don't have one yet, until `deadline` (the photo
 * copy job, lib/photos/mirror). Six at a time; saved as it goes. A video whose header has
 * no time is marked '' so it is not read again.
 */
export async function fillVideoTimes(deadline: number): Promise<{ read: number; found: number; remaining: number }> {
  const { readDriveRange, videosWithoutTime } = await import('./drive-browse');
  const times = await readVideoTimes();
  const todo = await videosWithoutTime(times);
  let read = 0, found = 0, i = 0, dirty = 0;
  while (i < todo.length && Date.now() < deadline) {
    const chunk = todo.slice(i, i + 6);
    i += chunk.length;
    const got = await Promise.all(chunk.map((id) => headerTime((s, l) => readDriveRange(id, s, l)).catch(() => null)));
    chunk.forEach((id, k) => { times[id] = got[k] ?? ''; read++; dirty++; if (got[k]) found++; });
    if (dirty >= 60) { await writeVideoTimes(times); dirty = 0; }
  }
  if (dirty) await writeVideoTimes(times);
  return { read, found, remaining: todo.length - read };
}
