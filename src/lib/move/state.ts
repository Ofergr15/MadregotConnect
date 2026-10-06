import { createServerClient } from '@/lib/supabase/server';
import { APP_VERSION } from '@/lib/version';

// ═════════════════════════════════════════════════════════════════════════════
// THE TOKYO → FRANKFURT MOVE (2026-10), as the app itself sees it.
//
// The copy itself runs from the operator's machine (pg_dump, storage copy,
// Vercel env) — a serverless function can do none of that. What the app owns
// is the part a person has to SEE: which database it is talking to right now,
// where its functions run, the maintenance gate, the progress the operator's
// scripts report, and the check suite (lib/move/checks.ts).
//
// Two rows in app_settings carry it, in whichever database the app is on:
//   move_status    progress log the scripts append to (also on the frozen
//                  Tokyo DB — they write as the admin role, which the freeze
//                  leaves alone), plus requests from this screen
//   move_snapshot  counts taken on FROZEN Tokyo: what Frankfurt must match
// ═════════════════════════════════════════════════════════════════════════════

export const OLD_REF = 'njzldypndkicpsmdtyll';
export const OLD_HOST = `${OLD_REF}.supabase.co`;
export const OLD_STORAGE_KEY = `sb-${OLD_REF}-auth-token`;

export type MovePhase = 'idle' | 'start_requested' | 'frozen' | 'copying' | 'switched' | 'open' | 'rollback_requested';
export interface MoveLogEntry { at: string; text: string; ok?: boolean }
export interface MoveStatus { phase: MovePhase; startedAt?: string; switchedAt?: string; openedAt?: string; log: MoveLogEntry[] }
export interface MoveSnapshot {
  at: string;
  source: string;
  tables: Record<string, number>;
  buckets: Record<string, { files: number; bytes: number }>;
  authUsers: number;
  strava: number;
  garmin: number;
  pushSubs: number;
}

export function connectedHost(): string {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname; } catch { return ''; }
}
export function connectedRef(): string { return connectedHost().split('.')[0] || ''; }
export function onNewProject(): boolean { const r = connectedRef(); return !!r && r !== OLD_REF; }

/** Vercel sets VERCEL_REGION on every function invocation. */
export function functionRegion(): string { return process.env.VERCEL_REGION || 'local'; }

const EMPTY: MoveStatus = { phase: 'idle', log: [] };

async function readJson<T>(key: string): Promise<T | null> {
  const { data } = await createServerClient().from('app_settings').select('value').eq('key', key).maybeSingle();
  if (!data?.value) return null;
  try { return JSON.parse(data.value as string) as T; } catch { return null; }
}
async function writeJson(key: string, value: unknown): Promise<void> {
  const { error } = await createServerClient().from('app_settings')
    .upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

export async function readMoveStatus(): Promise<MoveStatus> { return (await readJson<MoveStatus>('move_status')) ?? EMPTY; }
export async function readMoveSnapshot(): Promise<MoveSnapshot | null> { return readJson<MoveSnapshot>('move_snapshot'); }
export async function writeMoveSnapshot(s: MoveSnapshot): Promise<void> { return writeJson('move_snapshot', s); }

export async function appendMoveLog(text: string, patch: Partial<MoveStatus> = {}, ok = true): Promise<MoveStatus> {
  const cur = await readMoveStatus();
  const next: MoveStatus = { ...cur, ...patch, log: [...cur.log, { at: new Date().toISOString(), text, ok }].slice(-80) };
  await writeJson('move_status', next);
  return next;
}

export function baseInfo() {
  return {
    host: connectedHost(),
    ref: connectedRef(),
    onNew: onNewProject(),
    functionRegion: functionRegion(),
    version: APP_VERSION,
    storageKeyPinned: process.env.NEXT_PUBLIC_SUPABASE_AUTH_STORAGE_KEY?.trim() || null,
  };
}
