// Group chat photo messages (task 182) — the pure half: storage layout, attachment shape, checks.
// The sharp render, the upload and the signing are in ./photos-server.ts.
//
// A photo lives in the PRIVATE `group-chat-media` bucket (migration 347) under its group's folder,
// and the Stream message carries only the storage paths — never a URL. A URL is minted per read
// by GET /api/group-chat/photos, member-gated, signed for PHOTO_SIGN_TTL_S. So a photo that leaks
// out of the chat (a forwarded link, a screenshot of devtools) stops working within minutes, and
// a member who leaves the group loses the photos with the chat.

export const CHAT_PHOTO_BUCKET = 'group-chat-media';

/** Long-edge sizes written on upload. The camera original is never stored (it carries EXIF GPS). */
export const CHAT_PHOTO_SIZES = { thumb: 320, medium: 1080, full: 2048 } as const;
export type ChatPhotoSize = keyof typeof CHAT_PHOTO_SIZES;

/** Short on purpose: the client asks again when a link expires. */
export const PHOTO_SIGN_TTL_S = 300;

/** Camera photos run 3-6 MB; a screenshot of a 4K screen ~10 MB. */
export const CHAT_PHOTO_MAX_BYTES = 12 * 1024 * 1024;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
export const isAllowedChatPhotoType = (t: string | null | undefined) => !!t && ALLOWED_TYPES.has(t.toLowerCase());

/** The Stream attachment a photo message carries. `type` is ours, so Stream's UI never tries to load a URL. */
export interface ChatPhotoAttachment {
  type: 'group_photo';
  photo_id: string;
  paths: Record<ChatPhotoSize, string>;
  width: number | null;
  height: number | null;
}

const ID_RE = /^[0-9a-f-]{36}$/i;

export function chatPhotoPath(groupId: string, photoId: string, size: ChatPhotoSize): string {
  return `${groupId}/${photoId}@${size}.webp`;
}

export function chatPhotoAttachment(groupId: string, photoId: string, width: number | null, height: number | null): ChatPhotoAttachment {
  const paths = Object.fromEntries(
    (Object.keys(CHAT_PHOTO_SIZES) as ChatPhotoSize[]).map((s) => [s, chatPhotoPath(groupId, photoId, s)]),
  ) as Record<ChatPhotoSize, string>;
  return { type: 'group_photo', photo_id: photoId, paths, width, height };
}

/**
 * The photo attachments of a message that may be signed for THIS group. Anything whose path is
 * not exactly the shape this module writes under this group's folder is dropped — the message
 * body is client-reachable through Stream, and a crafted attachment must not sign another
 * group's photo (or any other object in the bucket).
 */
export function photosOf(attachments: unknown, groupId: string): ChatPhotoAttachment[] {
  if (!Array.isArray(attachments)) return [];
  const out: ChatPhotoAttachment[] = [];
  for (const a of attachments) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Partial<ChatPhotoAttachment>;
    if (x.type !== 'group_photo' || typeof x.photo_id !== 'string' || !ID_RE.test(x.photo_id)) continue;
    const expected = chatPhotoAttachment(groupId, x.photo_id, null, null).paths;
    const p = x.paths as Record<string, unknown> | undefined;
    if (!p || (Object.keys(expected) as ChatPhotoSize[]).some((s) => p[s] !== expected[s])) continue;
    out.push({
      type: 'group_photo',
      photo_id: x.photo_id,
      paths: expected,
      width: typeof x.width === 'number' && x.width > 0 ? Math.round(x.width) : null,
      height: typeof x.height === 'number' && x.height > 0 ? Math.round(x.height) : null,
    });
  }
  return out;
}

/** `?messageIds=a,b,c` → at most `max` well-formed Stream ids, deduped. */
export function parseMessageIds(raw: string | null, max = 30): string[] {
  return [...new Set((raw || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s)))].slice(0, max);
}
