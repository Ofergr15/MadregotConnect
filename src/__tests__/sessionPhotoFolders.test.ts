import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The automatic photo folder (Ofer, 2026-10-18): the quality days picked on the
 * weekly plan get a Drive folder at 20:00 the evening before; the next morning,
 * once photos are in it, the card goes up by itself. Drive, the plan, the album
 * fetch and the push are stubbed; the schedule and the "never twice" are real.
 */
const h = vi.hoisted(() => ({
  ensureDayFolder: vi.fn(async (_d: unknown, date: string) => ({ id: `folder-${date}`, link: `https://drive.google.com/drive/folders/folder-${date}` })),
  qualityDays: new Set<string>(),
  photos: 0,
  notify: vi.fn(async () => ({})),
  settings: {} as Record<string, string>,
  cards: [] as Array<{ id: string; payload: Record<string, unknown>; media: unknown[] | null }>,
}));

vi.mock('@/lib/google-drive/writer', () => ({ driveWriter: () => ({}), ensureDayFolder: h.ensureDayFolder }));
vi.mock('@/lib/quality-session/server', () => ({
  loadQualityWorkout: async (_s: unknown, date: string) => (h.qualityDays.has(date) ? { name: 'עליות', type: 'intervals' } : null),
}));
vi.mock('@/lib/quality-session/access', () => ({ storyEditorIds: async () => ['editor-1'] }));
vi.mock('@/lib/push', () => ({ notifyAthlete: h.notify }));
vi.mock('@/lib/quality-session/album-fetch', () => ({
  albumPhotoUrls: async () => (h.photos ? { ok: true, urls: Array.from({ length: h.photos }, (_, i) => `u${i}`) } : { ok: false, error: 'no-photos' }),
  pullAlbumPhotos: async (_s: unknown, _l: string, o: { max: number; skip?: number }) => ({
    ok: true, found: h.photos,
    media: Array.from({ length: Math.min(o.max, h.photos - (o.skip ?? 0)) }, (_, i) => ({ path: `p${(o.skip ?? 0) + i}`, url: 'x', w: 1, h: 1 })),
  }),
}));

/** Just enough of supabase-js for app_settings, athletes, attendance and feed_items. */
function db() {
  const q = (table: string) => {
    const f: Record<string, unknown> = {};
    let insert: Record<string, unknown> | null = null;
    let update: Record<string, unknown> | null = null;
    const api: Record<string, unknown> = {
      select: () => api, is: () => api, limit: () => api, order: () => api,
      eq: (k: string, v: unknown) => { f[k] = v; return api; },
      upsert: async (row: { key: string; value: string }) => { h.settings[row.key] = row.value; return { error: null }; },
      insert: (row: Record<string, unknown>) => { insert = row; return api; },
      update: (row: Record<string, unknown>) => { update = row; return api; },
      single: async () => {
        const id = `card-${h.cards.length + 1}`;
        h.cards.push({ id, payload: insert!.payload as Record<string, unknown>, media: insert!.media as unknown[] });
        return { data: { id }, error: null };
      },
      maybeSingle: async () => {
        if (table === 'app_settings') return { data: h.settings[f.key as string] ? { value: h.settings[f.key as string] } : null };
        if (table === 'athletes') return { data: { id: 'super-1' } };
        if (table === 'feed_items') return { data: h.cards.find(c => c.payload.date === f['payload->>date']) ?? null };
        return { data: null };
      },
      then: (res: (v: unknown) => unknown) => {
        if (update && table === 'feed_items') {
          const c = h.cards.find(x => x.id === f.id)!; Object.assign(c, update);
        }
        return Promise.resolve({ data: table === 'athletes' ? [{ id: 'runner-1' }, { id: 'runner-2' }] : [], error: null }).then(res);
      },
    };
    return api;
  };
  return { from: q } as never;
}

const { runSessionPhotoFolders, folderName, FOLDER_LEDGER_KEY } = await import('@/lib/quality-session/photos-server');
const at = (iso: string) => new Date(iso); // Israel is UTC+3 in October

beforeEach(() => {
  h.ensureDayFolder.mockClear(); h.notify.mockClear();
  h.qualityDays = new Set(['2026-10-20']); h.photos = 0; h.settings = {}; h.cards = [];
});

describe('the evening before a quality day', () => {
  it('nothing before 20:00', async () => {
    expect(await runSessionPhotoFolders(db(), at('2026-10-19T16:30:00Z'))).toEqual([]); // 19:30
    expect(h.ensureDayFolder).not.toHaveBeenCalled();
  });

  it('at 20:00: one folder named for the day, and the editors are told — once', async () => {
    const s = db();
    expect(await runSessionPhotoFolders(s, at('2026-10-19T17:00:00Z'))).toEqual(['sessionFolder:2026-10-20']);
    expect(h.ensureDayFolder).toHaveBeenCalledWith(expect.anything(), '2026-10-20', 'אימון איכות · שלישי 20.10');
    expect(h.notify.mock.calls.map(c => (c as unknown as [{ athleteId: string }])[0].athleteId).sort()).toEqual(['editor-1', 'super-1']);
    await runSessionPhotoFolders(s, at('2026-10-19T17:05:00Z'));
    expect(h.ensureDayFolder).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(2);
  });

  it('a day that is not a quality day gets no folder', async () => {
    h.qualityDays = new Set();
    expect(await runSessionPhotoFolders(db(), at('2026-10-19T17:00:00Z'))).toEqual([]);
  });

  it('names the folder for the day and its date', () => {
    expect(folderName('2026-10-13')).toBe('אימון איכות · שלישי 13.10');
  });
});

describe('the morning of the quality day', () => {
  const morning = async () => {
    const s = db();
    await runSessionPhotoFolders(s, at('2026-10-19T17:00:00Z'));
    h.notify.mockClear();
    return s;
  };

  it('an empty folder publishes nothing', async () => {
    const s = await morning();
    expect(await runSessionPhotoFolders(s, at('2026-10-20T05:00:00Z'))).toEqual([]); // 08:00
    expect(h.cards).toHaveLength(0);
  });

  it('photos in the folder: the card goes up with the first six, and the club is told', async () => {
    const s = await morning();
    h.photos = 9;
    expect(await runSessionPhotoFolders(s, at('2026-10-20T05:00:00Z'))).toEqual(['sessionPhotos:2026-10-20']);
    expect(h.cards).toHaveLength(1);
    expect(h.cards[0].media).toHaveLength(6);
    expect(h.cards[0].payload.link).toBe('https://drive.google.com/drive/folders/folder-2026-10-20');
    expect(h.notify).toHaveBeenCalledTimes(2); // runner-1, runner-2
  });

  it('photos that arrive later fill the card up to six, without another push', async () => {
    const s = await morning();
    h.photos = 2;
    await runSessionPhotoFolders(s, at('2026-10-20T05:00:00Z'));
    h.notify.mockClear(); h.photos = 8;
    expect(await runSessionPhotoFolders(s, at('2026-10-20T05:30:00Z'))).toEqual(['sessionPhotosMore:2026-10-20']);
    expect(h.cards).toHaveLength(1);
    expect(h.cards[0].media).toHaveLength(6);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('looks at most every half hour', async () => {
    const s = await morning();
    await runSessionPhotoFolders(s, at('2026-10-20T05:00:00Z'));
    h.photos = 3;
    expect(await runSessionPhotoFolders(s, at('2026-10-20T05:10:00Z'))).toEqual([]); // 10 min later: not yet
    expect(await runSessionPhotoFolders(s, at('2026-10-20T05:31:00Z'))).toEqual(['sessionPhotos:2026-10-20']);
  });

  it('keeps looking until 15:00 the next day, then stops', async () => {
    const s = await morning();
    h.photos = 3;
    expect(await runSessionPhotoFolders(s, at('2026-10-21T13:00:00Z'))).toEqual([]); // 16:00 the day after
    expect(JSON.parse(h.settings[FOLDER_LEDGER_KEY])['2026-10-20'].publishedId).toBeUndefined();
    expect(await runSessionPhotoFolders(s, at('2026-10-21T09:00:00Z'))).toEqual(['sessionPhotos:2026-10-20']); // 12:00 the day after
  });

  it('a folder made with "to the feed by itself" off never publishes', async () => {
    const s = await morning();
    const ledger = JSON.parse(h.settings[FOLDER_LEDGER_KEY]);
    ledger['2026-10-20'].autoFeed = false;
    h.settings[FOLDER_LEDGER_KEY] = JSON.stringify(ledger);
    h.photos = 5;
    expect(await runSessionPhotoFolders(s, at('2026-10-20T05:00:00Z'))).toEqual([]);
    expect(h.cards).toHaveLength(0);
  });

  it('a card someone published by hand with another link is left alone', async () => {
    const s = await morning();
    h.cards.push({ id: 'manual', payload: { kind: 'session_photos', date: '2026-10-20', link: 'https://photos.app.goo.gl/x', byAthleteId: 'a' }, media: [] });
    h.photos = 5;
    expect(await runSessionPhotoFolders(s, at('2026-10-20T05:00:00Z'))).toEqual([]);
    expect(h.cards[0].media).toEqual([]);
  });
});

describe('the push when the photos are up', () => {
  it('a quality morning names the workout; an event names its folder', async () => {
    const { sessionPhotosCopy } = await vi.importActual<typeof import('@/lib/notifications/copy')>('@/lib/notifications/copy');
    expect(sessionPhotosCopy('he', { workout: '15 × 200', event: 'אימון איכות · ראשון 18.10' }).title).toBe('📸 התמונות מאימון הבוקר עלו');
    const ev = sessionPhotosCopy('he', { workout: null, event: 'מרתון ולנסיה' });
    expect(ev.title).toBe('📸 התמונות עלו לאפליקציה');
    expect(ev.body).toBe('מרתון ולנסיה · לחיצה פותחת את כל התמונות');
  });
});
