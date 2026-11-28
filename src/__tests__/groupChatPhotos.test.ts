// Task 182: group chat photo messages — three re-encoded sizes in a private bucket, a message that
// carries paths not URLs, and member-gated signed links with a short TTL.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import {
  CHAT_PHOTO_SIZES, PHOTO_SIGN_TTL_S, chatPhotoAttachment, parseMessageIds, photosOf,
} from '@/lib/group-chat/photos';
import { renderChatPhoto } from '@/lib/group-chat/photos-server';

const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<object>()), resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));

const sendMessage = vi.fn();
const getMessage = vi.fn();
vi.mock('@/lib/stream/server', () => ({
  CHANNEL_TYPE: 'messaging',
  getStreamServerClient: () => ({ getMessage: (...a: unknown[]) => getMessage(...a) }),
}));
const notifyAthlete = vi.fn();
vi.mock('@/lib/push', () => ({ notifyAthlete: (...a: unknown[]) => notifyAthlete(...a) }));

let members: string[] | null = ['me', 'other'];
vi.mock('@/lib/group-chat/server', async (o) => ({
  ...(await o<object>()),
  groupChatMembers: async () => members,
  ensureGroupChannel: async () => ({ channel: { sendMessage: (...a: unknown[]) => sendMessage(...a) } }),
}));

const uploads: Array<{ bucket: string; path: string; type: string }> = [];
const removed: string[][] = [];
const signCalls: Array<{ paths: string[]; ttl: number }> = [];
let failUploadAt = -1;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _b: Buffer, o: { contentType: string }) => {
          if (uploads.length === failUploadAt) return { error: { message: 'disk full' } };
          uploads.push({ bucket, path, type: o.contentType });
          return { error: null };
        },
        remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
        createSignedUrls: async (paths: string[], ttl: number) => {
          signCalls.push({ paths, ttl });
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://s/${p}?token=t` })), error: null };
        },
      }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'N' } }) }) }) }),
  }),
}));

const { groupChannelId } = await import('@/lib/group-chat/server');
const route = await import('@/app/api/group-chat/photos/route');
const as = (c: object) => resolveVerifiedCaller.mockResolvedValue({ denied: null, caller: { athleteId: 'me', isStaff: false, isSuperUser: false, ...c } });

const PID = '11111111-2222-4333-8444-555555555555';
let jpeg: Buffer;
const post = async (fields: Record<string, string | Blob>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return route.POST(new Request('http://x/api/group-chat/photos', { method: 'POST', body: fd }));
};
const get = (q: string) => route.GET(new Request(`http://x/api/group-chat/photos?${q}`));

beforeEach(async () => {
  jpeg ??= await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#3a7' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'gps-ish' } } }).jpeg().toBuffer();
  members = ['me', 'other'];
  uploads.length = 0; removed.length = 0; signCalls.length = 0; failUploadAt = -1;
  sendMessage.mockReset().mockResolvedValue({ message: { id: 'srv-1' } });
  getMessage.mockReset();
  notifyAthlete.mockReset();
  as({});
});

describe('photos.ts rules', () => {
  it("photosOf keeps only this group's well-formed attachments", () => {
    const ok = chatPhotoAttachment('g1', PID, 2048, 1365);
    const other = chatPhotoAttachment('g2', PID, 1, 1);
    const forged = { ...ok, paths: { ...ok.paths, full: 'g2/secret@full.webp' } };
    expect(photosOf([ok, other, forged, { type: 'image', image_url: 'x' }, null], 'g1')).toEqual([ok]);
    expect(photosOf('nope', 'g1')).toEqual([]);
  });
  it('parseMessageIds dedupes, drops junk, caps', () => {
    expect(parseMessageIds('a,b,a, ,../x,c')).toEqual(['a', 'b', 'c']);
    expect(parseMessageIds(Array.from({ length: 50 }, (_, i) => `m${i}`).join(','))).toHaveLength(30);
  });
  it('signed links are short-lived', () => expect(PHOTO_SIGN_TTL_S).toBeLessThanOrEqual(600));
});

describe('renderChatPhoto', () => {
  it('three WebP sizes on the long edge, no enlarging, metadata dropped', async () => {
    const out = await renderChatPhoto(jpeg);
    expect(out.map((r) => [r.size, r.width])).toEqual([['thumb', 320], ['medium', 1080], ['full', 2048]]);
    for (const r of out) {
      const m = await sharp(r.body).metadata();
      expect(m.format).toBe('webp');
      expect(m.exif).toBeUndefined();
    }
    const small = await renderChatPhoto(await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000' } }).png().toBuffer());
    expect(small.every((r) => r.width === 200)).toBe(true);
  });
});

describe('POST /api/group-chat/photos', () => {
  it('stores three sizes under the group, sends paths (no URL), pushes the room but not the author', async () => {
    const res = await post({ groupId: 'g1', file: new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), text: 'finish line' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, id: 'srv-1', photo: { width: 2048, height: 1365 } });
    expect(uploads.map((u) => u.bucket)).toEqual(['group-chat-media', 'group-chat-media', 'group-chat-media']);
    expect(uploads.every((u) => u.path.startsWith('g1/') && u.type === 'image/webp')).toBe(true);
    const sent = sendMessage.mock.calls[0][0];
    expect(sent).toMatchObject({ text: 'finish line', user_id: 'me' });
    expect(sent.attachments[0].type).toBe('group_photo');
    expect(JSON.stringify(sent)).not.toMatch(/https?:/);
    expect(notifyAthlete.mock.calls.map((c) => c[0].athleteId)).toEqual(['other']);
  });
  it('a failed size rolls the others back and sends nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failUploadAt = 2;
    const res = await post({ groupId: 'g1', file: new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }) });
    expect(res.status).toBe(500);
    expect(removed[0]).toHaveLength(2);
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it('wrong type 415, undecodable 415, non-member 403, missing file 400, view-as 403', async () => {
    expect((await post({ groupId: 'g1', file: new Blob(['x'], { type: 'application/pdf' }) })).status).toBe(415);
    expect((await post({ groupId: 'g1', file: new Blob(['not an image'], { type: 'image/jpeg' }) })).status).toBe(415);
    expect((await post({ groupId: 'g1' })).status).toBe(400);
    members = ['other'];
    expect((await post({ groupId: 'g1', file: new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }) })).status).toBe(403);
    members = ['me', 'other'];
    as({ viewingAsBy: 'admin' });
    expect((await post({ groupId: 'g1', file: new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }) })).status).toBe(403);
    expect(uploads).toEqual([]);
  });
});

describe('GET /api/group-chat/photos', () => {
  const CID = `messaging:${groupChannelId('g1')}`;
  it('signs only this chat\'s live photo messages, in one call, with the short TTL', async () => {
    getMessage.mockImplementation(async (id: string) => ({
      message: id === 'm1' ? { cid: CID, attachments: [chatPhotoAttachment('g1', PID, 2048, 1365)] }
        : id === 'm2' ? { cid: 'messaging:elsewhere', attachments: [chatPhotoAttachment('g1', PID, 1, 1)] }
          : { cid: CID, type: 'deleted', attachments: [chatPhotoAttachment('g1', PID, 1, 1)] },
    }));
    const res = await get('groupId=g1&messageIds=m1,m2,m3');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.photos[ 'm1'][0].urls).sort()).toEqual(Object.keys(CHAT_PHOTO_SIZES).sort());
    expect(body.photos.m2).toEqual([]);
    expect(body.photos.m3).toEqual([]);
    expect(signCalls).toEqual([{ paths: Object.values(chatPhotoAttachment('g1', PID, null, null).paths), ttl: PHOTO_SIGN_TTL_S }]);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('non-member 403 before any message is read; no ids 400', async () => {
    members = ['other'];
    expect((await get('groupId=g1&messageIds=m1')).status).toBe(403);
    expect(getMessage).not.toHaveBeenCalled();
    members = ['me'];
    expect((await get('groupId=g1')).status).toBe(400);
  });
});

describe('migration 347', () => {
  it('creates the bucket private, idempotently', () => {
    const sql = readFileSync('supabase/migrations/347_group_chat_media_bucket.sql', 'utf8');
    expect(sql).toMatch(/'group-chat-media', 'group-chat-media', false/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE SET public = false/);
    expect(sql).not.toMatch(/CREATE POLICY/);
  });
});
