// A photo folder's kind and tags (Ofer, 10-20): what the photos screen filters by. Kept on
// the Drive folder itself (appProperties madregotType / madregotTags), so Drive stays the
// one record and nothing new needs a table; a folder nobody tagged gets its kind from its
// name. Pure: the screen and the server read it the same way.

export const FOLDER_KINDS = ['quality', 'long', 'race', 'event'] as const;
export type FolderKind = (typeof FOLDER_KINDS)[number];
export const KIND_LABEL: Record<FolderKind, string> = { quality: 'אימון איכות', long: 'ארוכה', race: 'מרוץ', event: 'אירוע' };
/** Tags offered first; any other word may be typed. */
export const SUGGESTED_TAGS = ['טסט', 'מרתון', 'חצי מרתון', 'עליות', 'מסלול', 'קבוצתי', 'נבחרת'];

/** The kind a folder's name says, when nobody set one. */
export function kindFromName(name: string): FolderKind {
  if (/איכות/.test(name)) return 'quality';
  if (/ארוכ/.test(name)) return 'long';
  if (/מרוץ|מירוץ|מרתון|חצי|תחרות|race|marathon/i.test(name)) return 'race';
  return 'event';
}

export function readKind(raw: unknown, name: string): FolderKind {
  return typeof raw === 'string' && (FOLDER_KINDS as readonly string[]).includes(raw) ? (raw as FolderKind) : kindFromName(name);
}

/** Tags as stored: one string, '|' between them (appProperties values are strings, 124 bytes at most). */
export function readTags(raw: unknown): string[] {
  return typeof raw === 'string' ? raw.split('|').map((t) => t.trim()).filter(Boolean).slice(0, 8) : [];
}
export function writeTags(tags: string[]): string {
  const clean = [...new Set(tags.map((t) => t.trim().replace(/\|/g, ' ')).filter(Boolean))];
  let out = '';
  for (const t of clean) { const next = out ? `${out}|${t}` : t; if (new TextEncoder().encode(next).length > 120) break; out = next; }
  return out;
}

/** Each tag its own colour (Ofer 10-20): the suggested ones fixed, any other by a hash of its text. */
const TAG_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];
export function tagColor(tag: string): string {
  const i = SUGGESTED_TAGS.indexOf(tag);
  if (i >= 0) return TAG_COLORS[i % TAG_COLORS.length];
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}
