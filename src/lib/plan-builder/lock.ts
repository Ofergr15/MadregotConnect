import { EDIT_LOCK_MODE, PLAN_LOCK_TTL_SEC } from './constants';

export interface LockRow {
  editor_id: string;
  editor_name: string | null;
  heartbeat_at: string;
  release_requested_by?: string | null;
  release_requested_at?: string | null;
}
export interface LockView {
  state: 'free' | 'mine' | 'other';
  editorName: string | null;
  /** Seconds until someone else's lock goes stale. */
  expiresInSec: number | null;
  releaseRequestedBy: string | null;
}

export function lockView(row: LockRow | null, me: string, now = Date.now(), ttl = PLAN_LOCK_TTL_SEC): LockView {
  const free: LockView = { state: 'free', editorName: null, expiresInSec: null, releaseRequestedBy: null };
  if (EDIT_LOCK_MODE === 'none' || !row) return free;
  const age = (now - Date.parse(row.heartbeat_at)) / 1000;
  if (!(age < ttl)) return free;
  return {
    state: row.editor_id === me ? 'mine' : 'other',
    editorName: row.editor_name,
    expiresInSec: Math.max(0, Math.round(ttl - age)),
    releaseRequestedBy: row.release_requested_by ?? null,
  };
}

/** Whether `me` may take (or refresh) the lock. */
export function mayTakeLock(row: LockRow | null, me: string, now = Date.now()): boolean {
  return lockView(row, me, now).state !== 'other';
}
