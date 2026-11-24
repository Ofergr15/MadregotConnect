/**
 * Staff edit of a GROUP chat's settings (name / image / description) — never a DM or a 1:1
 * academy thread. Only channel ids with a known group prefix are accepted.
 */
export const GROUP_CHANNEL_PREFIXES = ['academy-pack-', 'run-'] as const;
export const GROUP_NAME_MAX = 80;
export const GROUP_DESCRIPTION_MAX = 500;
export const GROUP_IMAGE_MAX = 1000;

export function isGroupChannelId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length > 200) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return false;
  return GROUP_CHANNEL_PREFIXES.some((p) => id.startsWith(p) && id.length > p.length);
}

export type GroupEditPatch = { name?: string; description?: string; image?: string };

/** Validates the body; returns the Stream `set` patch or an error string. */
export function parseGroupEdit(body: unknown): { patch: GroupEditPatch } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'invalid body' };
  const b = body as Record<string, unknown>;
  const patch: GroupEditPatch = {};
  if (b.name !== undefined) {
    if (typeof b.name !== 'string') return { error: 'name must be a string' };
    const name = b.name.trim();
    if (!name) return { error: 'name required' };
    if (name.length > GROUP_NAME_MAX) return { error: 'name too long' };
    patch.name = name;
  }
  if (b.description !== undefined) {
    if (typeof b.description !== 'string') return { error: 'description must be a string' };
    const d = b.description.trim();
    if (d.length > GROUP_DESCRIPTION_MAX) return { error: 'description too long' };
    patch.description = d;
  }
  if (b.image !== undefined) {
    if (typeof b.image !== 'string') return { error: 'image must be a string' };
    const img = b.image.trim();
    if (img.length > GROUP_IMAGE_MAX) return { error: 'image too long' };
    if (img && !/^https:\/\/[^\s]+$/.test(img)) return { error: 'image must be an https URL' };
    patch.image = img;
  }
  if (Object.keys(patch).length === 0) return { error: 'nothing to update' };
  return { patch };
}
