/**
 * Events v2 lifecycle + blocks (migration 184). Pure.
 *
 * Visibility rule, the one every events read goes through:
 *   - staff see everything;
 *   - everyone else sees an event when it is `published`, or `scheduled` with a
 *     `publish_at` that has passed (evaluated on read, so no cron is needed);
 *   - a row with no `status` field at all is published — that is every row before
 *     migration 184 is pasted, and nothing may vanish from the calendar then.
 *
 * `pending` (staff edits to a live event) is stripped before any row leaves the
 * server for a non-staff caller.
 */

export const EVENT_STATUSES = ['draft', 'scheduled', 'published'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const BLOCK_KINDS = [
  'countdown_distance_goal',
  'club_runners',
  'route',
  'schedule',
  'taper_plan',
  'travel_lodging',
  'free_text',
  'images',
  'link',
  'questionnaire',
  'results',
  'gallery',
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export function isBlockKind(v: unknown): v is BlockKind {
  return typeof v === 'string' && (BLOCK_KINDS as readonly string[]).includes(v);
}

export interface EventBlock {
  id?: string;
  kind: BlockKind;
  position: number;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface LifecycleRow {
  status?: string | null;
  publish_at?: string | null;
  pending?: unknown;
  [k: string]: unknown;
}

/** The effective status: a scheduled event whose moment has passed is published. */
export function effectiveStatus(row: LifecycleRow, now: Date): EventStatus {
  const s = row.status;
  if (s == null) return 'published';
  if (s === 'scheduled') {
    if (row.publish_at && new Date(row.publish_at).getTime() <= now.getTime()) return 'published';
    return 'scheduled';
  }
  return s === 'draft' ? 'draft' : 'published';
}

export function isVisibleTo(row: LifecycleRow, isStaff: boolean, now: Date): boolean {
  return isStaff || effectiveStatus(row, now) === 'published';
}

/** Filter + project a list for one caller. Staff keep `pending`; others never see it. */
export function projectEvents<T extends LifecycleRow>(rows: T[], isStaff: boolean, now: Date): T[] {
  return rows
    .filter((r) => isVisibleTo(r, isStaff, now))
    .map((r) => projectEvent(r, isStaff, now));
}

export function projectEvent<T extends LifecycleRow>(row: T, isStaff: boolean, now: Date): T {
  const out: Record<string, unknown> = { ...row };
  if ('status' in row) out.status = effectiveStatus(row, now);
  if (!isStaff) delete out.pending;
  else if ('pending' in row) out.has_pending = row.pending != null;
  return out as T;
}

/**
 * Normalise a client-supplied block list: drop unknown kinds, renumber positions
 * 0..n-1 in the given order, default `enabled` to true and `config` to {}.
 * Returns null when the input isn't an array.
 */
export function normaliseBlocks(input: unknown): EventBlock[] | null {
  if (!Array.isArray(input)) return null;
  const out: EventBlock[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    if (!isBlockKind(b.kind)) continue;
    out.push({
      ...(typeof b.id === 'string' ? { id: b.id } : {}),
      kind: b.kind,
      position: out.length,
      enabled: b.enabled !== false,
      config: b.config && typeof b.config === 'object' && !Array.isArray(b.config) ? (b.config as Record<string, unknown>) : {},
    });
  }
  return out;
}

/** Blocks a caller should see, in order. Members get enabled blocks only. */
export function visibleBlocks(blocks: EventBlock[], isStaff: boolean): EventBlock[] {
  return [...blocks].sort((a, b) => a.position - b.position).filter((b) => isStaff || b.enabled);
}

/**
 * Where an edit goes. A published (or already-live scheduled) event takes edits into
 * `pending`; a draft or a not-yet-live scheduled one is edited in place.
 */
export function editTarget(row: LifecycleRow, now: Date): 'live' | 'pending' {
  if (!('status' in row)) return 'live'; // pre-migration: no pending column either
  return effectiveStatus(row, now) === 'published' ? 'pending' : 'live';
}

export interface PendingVersion {
  fields?: Record<string, unknown>;
  blocks?: EventBlock[];
}

export function mergePending(prev: unknown, next: PendingVersion): PendingVersion {
  const p = (prev && typeof prev === 'object' ? prev : {}) as PendingVersion;
  return {
    fields: { ...(p.fields ?? {}), ...(next.fields ?? {}) },
    ...(next.blocks ? { blocks: next.blocks } : p.blocks ? { blocks: p.blocks } : {}),
  };
}

export type PublishMode = 'now' | 'schedule';

/**
 * The row patch a publish request makes. Returns an error string for a bad request.
 *  - draft/scheduled → now: status published, publish_at now.
 *  - draft/scheduled → schedule: status scheduled at `publishAt` (must be future).
 *  - published with pending → now: pending fields applied, version+1, pending cleared.
 *    (Scheduling an update to a live event isn't offered.)
 */
export function publishPatch(
  row: LifecycleRow & { version?: number | null },
  mode: PublishMode,
  publishAt: string | null | undefined,
  now: Date,
): { patch: Record<string, unknown>; blocks: EventBlock[] | null; kind: 'first' | 'update' | 'schedule' } | { error: string } {
  const status = effectiveStatus(row, now);
  if (status === 'published') {
    if (mode !== 'now') return { error: 'A live event can only be updated now' };
    if (row.pending == null) return { error: 'Nothing pending to publish' };
    const p = row.pending as PendingVersion;
    return {
      patch: { ...(p.fields ?? {}), pending: null, version: (row.version ?? 1) + 1, status: 'published' },
      blocks: p.blocks ?? null,
      kind: 'update',
    };
  }
  if (mode === 'schedule') {
    if (!publishAt || Number.isNaN(Date.parse(publishAt))) return { error: 'publish_at required' };
    if (Date.parse(publishAt) <= now.getTime()) return { error: 'publish_at must be in the future' };
    return { patch: { status: 'scheduled', publish_at: new Date(publishAt).toISOString() }, blocks: null, kind: 'schedule' };
  }
  return { patch: { status: 'published', publish_at: now.toISOString() }, blocks: null, kind: 'first' };
}

/** Postgres "relation/column does not exist" — the pre-migration fallback signal. */
export function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205' || error.code === 'PGRST204' ||
    /does not exist|could not find/i.test(error.message ?? '')
  );
}
