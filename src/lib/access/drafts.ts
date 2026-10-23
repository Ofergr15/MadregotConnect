import { randomUUID } from 'crypto';
import type { createServerClient } from '@/lib/supabase/server';
import type { ContentKind } from '@/lib/access/grants';

type Db = ReturnType<typeof createServerClient>;

// ═════════════════════════════════════════════════════════════════════════════
// "מפרסם באישור" (mockups/access-hub.html, Ofer 10-23): someone at level 2 publishes,
// and what they sent is kept as it was — the route and the request body — until an
// admin approves it. Approving replays the same request as that admin
// (/api/admin/content/drafts), so it goes out exactly as if the admin had sent it,
// with the times worked out at approval. One JSON list in app_settings, no migration.
// ═════════════════════════════════════════════════════════════════════════════

export const DRAFTS_KEY = 'content_drafts';
export type DraftPath = '/api/admin/publish/message' | '/api/admin/cheers' | '/api/admin/surveys' | '/api/admin/club-stories';
export interface Draft {
  id: string; kind: ContentKind; path: DraftPath; body: unknown;
  byId: string | null; byName: string | null; at: string; title: string;
}

export async function readDrafts(db: Db): Promise<Draft[]> {
  const { data } = await db.from('app_settings').select('value').eq('key', DRAFTS_KEY).maybeSingle();
  try { const v = JSON.parse((data as { value?: string } | null)?.value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
async function writeDrafts(db: Db, list: Draft[]): Promise<void> {
  const { error } = await db.from('app_settings').upsert({ key: DRAFTS_KEY, value: JSON.stringify(list.slice(0, 100)), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

/** The line an admin reads in "מחכה לאישורך": the text, the question, the cheer. */
export function draftTitle(path: DraftPath, body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const t = path === '/api/admin/surveys' ? b.question_he : path === '/api/admin/club-stories' ? (b.title || b.text) : b.text;
  return String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
}

export async function addDraft(db: Db, d: Omit<Draft, 'id' | 'at' | 'title'>): Promise<Draft> {
  const draft: Draft = { ...d, id: randomUUID(), at: new Date().toISOString(), title: draftTitle(d.path, d.body) };
  await writeDrafts(db, [draft, ...(await readDrafts(db))]);
  return draft;
}
export async function takeDraft(db: Db, id: string): Promise<Draft | null> {
  const list = await readDrafts(db);
  const d = list.find((x) => x.id === id) ?? null;
  if (d) await writeDrafts(db, list.filter((x) => x.id !== id));
  return d;
}
