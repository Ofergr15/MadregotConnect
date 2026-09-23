/**
 * "What's new": one release a day, and the owner picks what it says.
 *
 * ── THE PIECES ─────────────────────────────────────────────────────────────
 * - Notes live in src/content/release-notes.json, newest first, one per change,
 *   written with the change itself. The file is append-only, so every build
 *   carries the notes of every release before it.
 * - Production deploys the `production` branch. NOTHING reaches it without the
 *   owner's approval: he approves a release in /dashboard/whats-new, which pins
 *   the exact main commit he was looking at (`release_approvals`, migration 122),
 *   and the 05:00 workflow (.github/workflows/daily-release.yml) moves
 *   `production` to that commit — not to whatever main has become since. No
 *   approval, no release.
 * - The first request a new release deploy serves records a `releases` row: its
 *   APP_VERSION and the note ids not in any earlier release (migration 121).
 * - The owner's picks (`release_note_picks`) say which notes get the big card in
 *   the sheet, with optional rewording. Nothing is featured until he stars it.
 * - The featured notes of the releases this bundle has become entries of the
 *   existing "What's new" sheet (components/whats-new), and so live by ITS
 *   rules: once per entry, never to a device newer than the entry, three rows
 *   at most, only over a loaded feed. A day of fixes adds no entry at all.
 */

import notesJson from '@/content/release-notes.json';
import { compareAppVersions } from '@/lib/feedback/lifecycle';
import { israelToday } from '@/lib/utils';
import type { WhatsNewEntry } from '@/lib/whats-new/entries';

export type NoteKind = 'feature' | 'fix';

export interface ReleaseNote {
  id: string;
  date: string;
  kind: NoteKind;
  icon: string;
  title: string;
  body: string;
  /** 'staff' = only admins and coaches see it (a tool nobody else has). */
  audience?: 'staff';
  /** The page that shows it — a route under src/app/(app). Default: the release history. */
  href?: string;
}

export interface NotePick {
  note_id: string;
  featured: boolean;
  title: string | null;
  body: string | null;
}

export interface ReleaseRow {
  id: number;
  released_at: string;
  app_version: string;
  note_ids: string[];
}

/** A note as shown: the owner's wording over the file's, and whether it is featured. */
export interface ShownNote extends ReleaseNote {
  featured: boolean;
  edited: boolean;
}

export const BUNDLED_NOTES = notesJson as ReleaseNote[];

/** The branch production deploys. Only a deploy of it records a release. */
export const RELEASE_BRANCH = 'production';

/** The repo is public, so main's head and its notes are read without a token. */
export const GITHUB_REPO = 'Ofergr15/MadregotConnect';
export const MAIN_SHA_URL = `https://api.github.com/repos/${GITHUB_REPO}/commits/main`;
export const notesUrlAt = (ref: string) =>
  `https://raw.githubusercontent.com/${GITHUB_REPO}/${ref}/src/content/release-notes.json`;
export const isSha = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);

/** One approval: the commit that may go out, and the notes it carries. */
export interface ApprovalRow {
  id: number;
  sha: string;
  note_ids: string[];
  approved_at: string;
}

/**
 * Split the waiting notes by the standing approval: those it covers go out at
 * 05:00; anything that reached main after it waits for the next approval.
 */
export function splitByApproval<T extends { id: string }>(
  pending: T[], approval: Pick<ApprovalRow, 'note_ids'> | null,
): { approved: T[]; waiting: T[] } {
  const ok = new Set(approval?.note_ids ?? []);
  return { approved: pending.filter(n => ok.has(n.id)), waiting: pending.filter(n => !ok.has(n.id)) };
}

export function releasedIds(releases: Pick<ReleaseRow, 'note_ids'>[]): Set<string> {
  return new Set(releases.flatMap(r => r.note_ids));
}

/** Notes in `notes` that no release has carried yet. */
export function unreleased(notes: ReleaseNote[], releases: Pick<ReleaseRow, 'note_ids'>[]): ReleaseNote[] {
  const done = releasedIds(releases);
  return notes.filter(n => !done.has(n.id));
}

export function applyPick(note: ReleaseNote, pick: NotePick | undefined): ShownNote {
  return {
    ...note,
    title: pick?.title?.trim() || note.title,
    body: pick?.body?.trim() || note.body,
    featured: pick ? pick.featured : false,
    edited: !!(pick?.title?.trim() || pick?.body?.trim()),
  };
}

export function shownNotes(
  ids: string[],
  notes: ReleaseNote[],
  picks: NotePick[],
  opts: { staff: boolean },
): ShownNote[] {
  const byId = new Map(notes.map(n => [n.id, n]));
  const pickBy = new Map(picks.map(p => [p.note_id, p]));
  return ids
    .map(id => byId.get(id))
    .filter((n): n is ReleaseNote => !!n && (opts.staff || n.audience !== 'staff'))
    .map(n => applyPick(n, pickBy.get(n.id)));
}

export interface WhatsNewRelease {
  id: number;
  released_at: string;
  app_version: string;
  notes: ShownNote[];
}

export const HISTORY_HREF = '/dashboard/whats-new';

/**
 * The featured notes of every release this bundle already runs, as entries of
 * the "What's new" sheet. A release newer than the bundle waits for the silent
 * update to land it, so the sheet never announces what the phone can't show.
 * `publishedAt` is the release day, which is what the ledger's rule 1 compares.
 */
export function releaseEntries(releases: WhatsNewRelease[], appVersion: string): WhatsNewEntry[] {
  return releases
    .filter(r => compareAppVersions(appVersion, r.app_version) >= 0)
    .flatMap(r => r.notes
      .filter(n => n.featured)
      .map((n): WhatsNewEntry => {
        const copy = { title: n.title, body: n.body };
        return {
          slug: `release:${n.id}`,
          publishedAt: israelToday(new Date(r.released_at)),
          icon: n.icon,
          href: n.href ?? HISTORY_HREF,
          he: copy,
          en: copy,
        };
      }));
}
