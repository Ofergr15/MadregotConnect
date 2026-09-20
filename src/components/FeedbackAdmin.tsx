'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Loader2, MessageSquare, Trash2, Bug, Lightbulb, Dumbbell, MessageCircle, Search,
  Smartphone, Archive, ArchiveRestore, GitBranch, Sparkles, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';
import { reviewContextRows, type ReviewContext } from '@/lib/review-context';
import {
  FEEDBACK_STATUS_ORDER, normalizeStatus, STATUS_LABEL_KEY, STATUS_PILL,
  type FeedbackStatus,
} from '@/lib/feedback/status';
import {
  FEEDBACK_VIEWS, feedbackView, groupDuplicates, reporterNeedsReload, VIEW_LABEL_KEY,
  viewCounts, type FeedbackView,
} from '@/lib/feedback/lifecycle';
import { Sheet, ConfirmSheet, SegmentedControl, EmptyState, LoadingBlock, Spinner } from '@/components/ui';
import { InsetSection } from '@/components/ui/InsetList';

/**
 * The staff side of /dashboard/review: every report the club has filed, and the
 * triage controls for them.
 *
 * ── WHY IT'S A COMPONENT AND NOT A SCREEN ──────────────────────────────────
 * This UI lived inline in the Settings page's "Feedback" tab, which is four taps
 * deep behind a grid of eleven management tabs — so in practice the reports
 * arrived and nobody read them (every report in prod was still `status = 'new'`).
 * It now has its own destination at /dashboard/feedback, linked straight from
 * the review screen, while Settings keeps its tab by rendering this same
 * component. One implementation, two entry points: the alternative was a second
 * copy of the status/priority/notes logic, which is exactly how the desktop nav
 * and the tab bar drifted apart before.
 *
 * ── WHY IT IS FIVE VIEWS AND NOT FIVE SECTIONS ─────────────────────────────
 * It used to be Open / Closed / All over five stacked status sections, which is
 * the state of a report and not a thing to do about it. Three questions had no
 * home at all: what fixed this, does the reporter agree it's fixed, and is this
 * the same bug as that one. The five views are the drawers those answers live in
 * (see lib/feedback/lifecycle.ts), and the row now carries the fix version, the
 * overnight diagnosis and the faces of everybody who reported the same thing.
 *
 * Everything the 116 columns drive degrades to the old behaviour when the
 * migration has not been applied: they read null, the row lands in the view
 * `status` alone would have put it in, and the fix-link editor reports that its
 * save didn't stick rather than pretending it did.
 *
 * Everything here is staff-only by virtue of the API: GET/PATCH/DELETE
 * /api/feedback all call requireStaff, so a non-staff caller gets an empty list
 * rather than a hidden-but-fetchable one.
 */

type FeedbackCategory = 'feature_request' | 'bug_report' | 'training_feedback' | 'general';
type FeedbackPriority = 'low' | 'medium' | 'high';

export interface FeedbackItem {
  id: string;
  athlete_name: string;
  athlete_email: string | null;
  group_name: string | null;
  message: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  admin_notes: string | null;
  sort_order: number | null;
  /** Whether this report has a screenshot — NOT the screenshot itself. They are
   *  stored base64 in the row and were 98% of the list response (366 KB of 370 KB),
   *  for images the list does not render. The sheet fetches the one it opens. */
  has_image: boolean;
  created_at: string;
  /** Auto-collected diagnostics (migration 093) — see src/lib/review-context.ts.
   *  Null on every report filed before that shipped, so it renders conditionally. */
  context: ReviewContext | null;
  // ── Migration 116. Every one of these is undefined until it is applied. ──
  fixed_in_version?: string | null;
  fix_branch?: string | null;
  fix_commit?: string | null;
  triaged_by?: string | null;
  triaged_at?: string | null;
  triage_note?: string | null;
  duplicate_of?: string | null;
  verified_at?: string | null;
  archived_at?: string | null;
}

// `labelKey` into the `settings` namespace, which has had all four of these
// strings all along. They used to be hardcoded English literals, so the one
// screen a Hebrew-speaking club files bugs into answered "Bug Report" —
// untranslated, and the long English words are also what overflowed the filter.
const categoryConfig = {
  feature_request: { labelKey: 'featureRequest', icon: Lightbulb, color: 'text-purple-800', bg: 'bg-purple-500/15', border: 'border-purple-500/30' },
  bug_report: { labelKey: 'bugReport', icon: Bug, color: 'text-accent-red-ink', bg: 'bg-accent-red/15', border: 'border-accent-red/30' },
  training_feedback: { labelKey: 'trainingFeedback', icon: Dumbbell, color: 'text-band-2-ink', bg: 'bg-band-2/15', border: 'border-band-2/30' },
  general: { labelKey: 'general', icon: MessageCircle, color: 'text-teal-600', bg: 'bg-teal-500/15', border: 'border-teal-500/30' },
} as const;

const priorityConfig = {
  low: { label: 'Low', bg: 'bg-band-2/15', text: 'text-band-2-ink', border: 'border-band-2/30' },
  medium: { label: 'Medium', bg: 'bg-band-3/15', text: 'text-band-3-ink', border: 'border-band-3/30' },
  high: { label: 'High', bg: 'bg-accent-red/15', text: 'text-accent-red-ink', border: 'border-accent-red/30' },
};

/** Initials for a duplicate's face. Two letters, upper case in either script. */
const initials = (name: string) =>
  name.trim().split(/\s+/).map(n => n[0] || '').join('').toUpperCase().slice(0, 2);

export function FeedbackAdmin() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  // Status labels come from the `review` namespace — the same words the athlete
  // who filed the report reads on their own list. This screen used to have its own
  // set ("ספרינט", "בוצע"), so one report had two names for its state depending on
  // who was looking at it. See lib/feedback/status.ts (2d076a9c).
  const tr = useTranslations('review');
  const statusLabel = (s: FeedbackStatus) => tr(STATUS_LABEL_KEY[s]);
  const locale = useLocale();
  const catLabel = (c: FeedbackCategory) => t(categoryConfig[c].labelKey);
  const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(
    locale === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' },
  );

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [filterCategory, setFilterCategory] = useState<FeedbackCategory | 'all'>('all');
  // Opens on the inbox — the only view that needs a decision today. The five
  // status sections used to be stacked on one scroll, so the outstanding work and
  // the year's closed pile looked like one undifferentiated list (2d076a9c).
  const [view, setView] = useState<FeedbackView>('inbox');
  const [query, setQuery] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  // The fix link, edited as one form and saved as one PATCH: a version without
  // the branch it came from is half an answer six weeks later.
  const [fix, setFix] = useState({ version: '', branch: '', commit: '' });
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  /** Set when a lifecycle save came back unsaved — i.e. migration 116 is pending. */
  const [lifecycleMissing, setLifecycleMissing] = useState(false);
  // The open report's screenshot, fetched on open rather than shipped with the
  // list. Keyed by id so a stale response for the report you just closed can't
  // paint itself over the one you opened next.
  const [image, setImage] = useState<{ id: string; url: string | null } | null>(null);
  const [imageLoading, setImageLoading] = useState(false);

  const openReport = async (item: FeedbackItem) => {
    setSelected(item);
    setAdminNotes(item.admin_notes || '');
    setFix({
      version: item.fixed_in_version || '',
      branch: item.fix_branch || '',
      commit: item.fix_commit || '',
    });
    setImage(null);
    if (!item.has_image) return;
    setImageLoading(true);
    try {
      const res = await fetch(`/api/feedback?image=${encodeURIComponent(item.id)}`, { headers: await apiHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setImage({ id: item.id, url: data.image_url ?? null });
    } catch {
      /* the report is still readable without its screenshot */
    } finally {
      setImageLoading(false);
    }
  };

  const fetchFeedback = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/feedback', { headers: await apiHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.feedback || []);
    } catch {
      /* leaves the previous list up rather than blanking it */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFeedback(); }, []);

  /**
   * One PATCH for everything the sheet can change.
   *
   * Optimistic, because triaging is a rapid-fire activity: the segmented control
   * has to answer the tap, not the round trip. The response's `lifecycleSaved`
   * is the one thing read back — a false means migration 116 is pending, and the
   * screen says so rather than showing a fix version that isn't in the database.
   */
  const patch = async (id: string, changes: Partial<FeedbackItem> & { archived?: boolean }) => {
    const { archived, ...fields } = changes;
    const patched: Partial<FeedbackItem> = { ...fields };
    if (archived !== undefined) patched.archived_at = archived ? new Date().toISOString() : null;
    setItems(prev => prev.map(f => f.id === id ? { ...f, ...patched } : f));
    setSelected(prev => prev && prev.id === id ? { ...prev, ...patched } : prev);
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: await apiHeaders(true),
        body: JSON.stringify({ id, ...fields, ...(archived !== undefined ? { archived } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.lifecycleSaved === false) setLifecycleMissing(true);
    } catch {
      await fetchFeedback();
    }
  };

  const remove = async (id: string) => {
    setUpdating(id);
    try {
      const res = await fetch('/api/feedback', {
        method: 'DELETE',
        headers: await apiHeaders(true),
        body: JSON.stringify({ id }),
      });
      if (res.ok) { setSelected(null); await fetchFeedback(); }
    } catch {
      /* the sheet stays open, so the failure is visible as "nothing happened" */
    } finally {
      setUpdating(null);
    }
  };

  const counts = useMemo(() => viewCounts(items), [items]);

  // The search runs over the message, the reporter and their group — the three
  // things you actually have when someone says "I reported this last week".
  // It also crosses views: a search is a question about all of history, and
  // answering it inside the current drawer is how "I reported this months ago"
  // came back as nothing.
  const needle = query.trim().toLowerCase();
  const matches = (item: FeedbackItem) => {
    if (filterCategory !== 'all' && (item.category || 'general') !== filterCategory) return false;
    if (!needle) return feedbackView(item) === view;
    return [item.message, item.athlete_name, item.athlete_email, item.group_name, item.fix_branch, item.fixed_in_version]
      .some(v => (v || '').toLowerCase().includes(needle));
  };
  // Grouped BEFORE filtering, so a primary keeps its faces even when the copies
  // themselves are archived out of the current view.
  const issues = useMemo(() => groupDuplicates(items), [items]);
  const visible = issues.filter(issue => matches(issue.primary));

  /** Candidates to merge the open report into: anything else still on the page. */
  const mergeTargets = selected
    ? items.filter(i => i.id !== selected.id && !i.duplicate_of && !i.archived_at).slice(0, 40)
    : [];

  const selectedIssue = selected ? issues.find(i => i.primary.id === selected.id) : undefined;

  return (
    <>
      {selected && (
        <Sheet open onOpenChange={(o) => { if (!o) { setSelected(null); setConfirmDeleteOpen(false); } }}>
          {/* min-w-0 + truncate the whole way down: an email address is a single
              unbreakable word, and a synthetic Strava one
              (strava_106828158@strava.madregot.local) is long enough to widen the
              sheet past the screen on its own. */}
          <div className="pb-4 mb-1 border-b border-page/50 flex items-center">
            <div className="flex min-w-0 items-center gap-3">
              <div className="w-11 h-11 shrink-0 rounded-full bg-brand-600/15 flex items-center justify-center">
                <span className="text-sm font-bold text-brand-600">{initials(selected.athlete_name)}</span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-ink-700">{selected.athlete_name}</p>
                <div className="flex min-w-0 items-center gap-1 mt-0.5">
                  {selected.athlete_email && <span className="truncate text-xs text-ink-400">{selected.athlete_email}</span>}
                  {selected.group_name && <span className="shrink-0 text-xs text-ink-400">· {selected.group_name}</span>}
                </div>
              </div>
            </div>
          </div>
          <div className="pt-4">
            {/* flex-wrap, because the chip plus a full "Wednesday, September 3,
                2026, 09:41 PM" timestamp is wider than a phone every single time —
                this row was the widest thing in the sheet. The date is also
                short-form now and localized; it was hardcoded en-US in an
                otherwise Hebrew screen. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-4">
              {(() => {
                const category = selected.category || 'general';
                const catConfig = categoryConfig[category];
                const CatIcon = catConfig.icon;
                return (
                  <span className={cn('flex min-w-0 items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border', catConfig.bg, catConfig.border, catConfig.color)}>
                    <CatIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{catLabel(category)}</span>
                  </span>
                );
              })()}
              <span className="text-xs text-ink-400">
                {/* Bare <bdi> (i.e. dir="auto"), not dir="ltr": the Hebrew date reads
                    "6 בספט׳ 2026, 20:15" — it opens with a neutral digit and then a
                    Hebrew month, so forcing LTR reorders it. auto takes the direction
                    from the first strong character, which is right in both locales. */}
                <bdi>
                  {new Date(selected.created_at).toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </bdi>
              </span>
            </div>
            {/* break-words: a report is often a pasted URL or a stack trace, i.e.
                one unbreakable token far wider than the sheet. */}
            <p className="text-base text-ink-700 leading-relaxed whitespace-pre-wrap break-words mb-4" dir="auto">{selected.message}</p>

            {/* Everybody who reported the same thing. Four reports of one bug used
                to be four rows to decide four times, which is most of what made
                this screen feel endless. */}
            {selectedIssue && selectedIssue.duplicates.length > 0 && (
              <div className="mb-4 flex items-center gap-2 border-t border-dashed border-page pt-3">
                <div className="flex">
                  {[selectedIssue.primary, ...selectedIssue.duplicates].slice(0, 5).map((r, i) => (
                    <span
                      key={r.id}
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-brand-600/10 text-3xs font-bold text-brand-600',
                        i > 0 && '-ms-2',
                      )}
                    >
                      {initials(r.athlete_name)}
                    </span>
                  ))}
                </div>
                <span className="text-2xs font-semibold text-ink-400">
                  {t('reportedByCount', { count: selectedIssue.reporterCount })}
                </span>
              </div>
            )}

            {selected.has_image && (
              imageLoading || image?.id !== selected.id ? (
                // Reserves the same height the image will take, so opening a report
                // with a screenshot doesn't shove the triage controls down a moment
                // after they are already under the reader's thumb.
                <div className="mb-5 flex h-48 items-center justify-center rounded-lg border border-page/50 bg-page/30">
                  <Spinner />
                </div>
              ) : image.url ? (
                // max-w-full, or a landscape screenshot is scaled by max-h-48 to a
                // width the sheet can't hold and the whole sheet scrolls sideways.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.url} alt="Attached" className="max-h-48 max-w-full rounded-lg border border-page/50 mb-5" />
              ) : null
            )}

            {/* The reporter's device, app version and the screen it happened on.
                Same rows, from the same function, that the athlete saw before
                they sent it — the point of showing it to them is that it is
                exactly what lands here. */}
            {(() => {
              const rows = reviewContextRows(selected.context, {
                page: 'Screen', version: 'Version', device: 'Device', screen: 'Viewport', mode: 'Running as',
              });
              if (rows.length === 0) return null;
              return (
                <dl className="mb-5 rounded-xl bg-page/50 px-3.5 py-3 space-y-1.5">
                  {rows.map(r => (
                    <div key={r.label} className="flex items-baseline gap-2 text-2xs">
                      <dt className="w-20 shrink-0 text-ink-400">{r.label}</dt>
                      {/* break-words: "Viewport" and the device string are long
                          unbreakable tokens (390×844, iPhone; iOS 18.5), and
                          min-w-0 alone doesn't break a single word. */}
                      <dd className="min-w-0 flex-1 break-words font-medium text-ink-700" dir="auto">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              );
            })()}

            {/* ── The story of this report ──
                Reported → diagnosed → in flight → shipped → confirmed. The last
                row is deliberately hollow until the REPORTER says it's fixed:
                `done` is our opinion, and a report closed on our word alone is
                how somebody ends up watching the bug on a stale service worker
                and concluding nobody listened. */}
            {(() => {
              const status = normalizeStatus(selected.status);
              const done = status === 'done';
              const steps: { key: string; label: string; detail?: string | null; pending?: boolean; mono?: string | null }[] = [
                {
                  key: 'reported',
                  label: t('timelineReported'),
                  detail: [dateLabel(selected.created_at), selected.athlete_name.split(' ')[0]].join(' · '),
                },
                {
                  key: 'triaged',
                  label: t('timelineTriaged', { status: statusLabel(status) }),
                  detail: selected.triaged_at
                    ? `${dateLabel(selected.triaged_at)} · ${selected.triaged_by || ''}`.trim()
                    : null,
                  pending: !selected.triaged_at,
                },
                {
                  key: 'flight',
                  label: t('timelineFlight'),
                  mono: selected.fix_branch || null,
                  pending: !selected.fix_branch && !done,
                },
                {
                  key: 'shipped',
                  label: selected.fixed_in_version
                    ? t('timelineShippedIn', { version: selected.fixed_in_version })
                    : t('timelineShipped'),
                  mono: selected.fix_commit || null,
                  pending: !done,
                },
                {
                  key: 'verified',
                  label: t('timelineVerified'),
                  detail: selected.verified_at
                    ? dateLabel(selected.verified_at)
                    : reporterNeedsReload(selected)
                      ? t('timelineNeedsReload', {
                        on: selected.context?.appVersion || '', version: selected.fixed_in_version || '',
                      })
                      : t('timelineWaitingReporter'),
                  pending: !selected.verified_at,
                },
              ];
              return (
                <ol className="mb-5 space-y-0">
                  {steps.map((s, i) => (
                    <li key={s.key} className="relative flex gap-3 pb-3 last:pb-0">
                      {/* The rail is drawn per-row rather than as one absolute line
                          behind the list: `inset-inline-start` on a single element
                          is fine, but its height has to stop at the last dot, and
                          "the height of everything except the last row" is not a
                          thing CSS can say. */}
                      <div className="relative flex w-2.5 shrink-0 justify-center">
                        <span
                          className={cn(
                            'z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                            s.pending ? 'border-2 border-ink-300 bg-card' : 'bg-brand-600',
                          )}
                        />
                        {i < steps.length - 1 && (
                          <span className="absolute top-3 bottom-0 w-0.5 bg-page" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-xs font-bold', s.pending ? 'text-ink-400' : 'text-ink-700')}>{s.label}</p>
                        {s.detail && <p className="mt-0.5 text-3xs leading-relaxed text-ink-400" dir="auto">{s.detail}</p>}
                        {/* Its own left-aligned row: a branch name or a sha alone
                            in an RTL line is dragged to the far edge, away from
                            the label it belongs to. */}
                        {s.mono && (
                          <p className="mt-0.5 break-all font-mono text-3xs text-ink-400" dir="ltr" style={{ textAlign: 'left' }}>
                            {s.mono}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              );
            })()}

            {/* The overnight diagnosis, when something wrote one. Kept verbatim and
                attributed: a verdict with no author is a thing you can't argue
                with, and the morning job is supposed to be accept-or-reject. */}
            {selected.triage_note && (
              <div className="mb-5 rounded-xl border border-brand-600/15 bg-brand-600/5 px-3 py-2.5">
                <div className="mb-1 flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 shrink-0 text-brand-600" />
                  <span className="text-3xs font-bold text-brand-700">
                    {t('triageBy', { by: selected.triaged_by || 'cron' })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-2xs leading-relaxed text-ink-700" dir="auto">
                  {selected.triage_note}
                </p>
              </div>
            )}

            <div className="border-t border-page/50 pt-4 space-y-4">
              <div className={cn(updating === selected.id && 'opacity-50 pointer-events-none')}>
                <label className="text-xs font-semibold text-ink-400 mb-2 block">{t('status')}</label>
                <SegmentedControl<FeedbackStatus>
                  value={normalizeStatus(selected.status)}
                  onChange={(status) => patch(selected.id, { status, priority: selected.priority || 'medium' })}
                  options={FEEDBACK_STATUS_ORDER.map(status => ({ value: status, label: statusLabel(status) }))}
                />
              </div>
              <div className={cn(updating === selected.id && 'opacity-50 pointer-events-none')}>
                <label className="text-xs font-semibold text-ink-400 mb-2 block">{t('priority')}</label>
                <SegmentedControl<FeedbackPriority>
                  value={selected.priority || 'medium'}
                  onChange={(priority) => patch(selected.id, { priority })}
                  options={(['low', 'medium', 'high'] as FeedbackPriority[]).map(priority => ({ value: priority, label: t(priority) }))}
                />
              </div>
              {updating === selected.id && (
                <div className="flex items-center gap-2 text-xs text-ink-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t('updating')}
                </div>
              )}

              {/* ── What fixed it ──
                  This is the whole reason six bugs fixed in 2.40.35 still read as
                  untouched: the only record of a fix was one overwritten line of
                  `admin_notes`, with no author and no history. Three fields, one
                  save, and the version is what the reporter's push names as the
                  build to reload into. */}
              <div className="pt-3 border-t border-page/50">
                <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-400">
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  {t('fixSection')}
                </label>
                {/* dir="ltr" on each input: a version, a branch and a sha are all
                    LTR tokens, and typing them into an RTL field puts the caret and
                    the punctuation on the wrong side. */}
                <div className="space-y-2">
                  <input
                    type="text" dir="ltr" value={fix.version} inputMode="decimal"
                    onChange={e => setFix(f => ({ ...f, version: e.target.value }))}
                    placeholder={t('fixVersionPlaceholder')}
                    className="w-full rounded-lg border border-page/50 bg-page/50 px-3 py-2 font-mono text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-1 focus:ring-brand-600/50"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text" dir="ltr" value={fix.branch}
                      onChange={e => setFix(f => ({ ...f, branch: e.target.value }))}
                      placeholder={t('fixBranchPlaceholder')}
                      className="min-w-0 flex-1 rounded-lg border border-page/50 bg-page/50 px-3 py-2 font-mono text-xs text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-1 focus:ring-brand-600/50"
                    />
                    <input
                      type="text" dir="ltr" value={fix.commit}
                      onChange={e => setFix(f => ({ ...f, commit: e.target.value }))}
                      placeholder={t('fixCommitPlaceholder')}
                      className="w-24 shrink-0 rounded-lg border border-page/50 bg-page/50 px-3 py-2 font-mono text-xs text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-1 focus:ring-brand-600/50"
                    />
                  </div>
                  <button
                    onClick={() => patch(selected.id, {
                      fixed_in_version: fix.version.trim() || null,
                      fix_branch: fix.branch.trim() || null,
                      fix_commit: fix.commit.trim() || null,
                    })}
                    className="min-h-[44px] w-full rounded-lg bg-brand-600 px-3 text-xs font-bold text-white transition-colors hover:bg-brand-700"
                  >
                    {tc('save')}
                  </button>
                </div>
                {lifecycleMissing && (
                  // The save reached the database and the database refused the
                  // column. Saying so is the only alternative to a screen that
                  // shows a fix version nobody can read back.
                  <p className="mt-1.5 text-3xs font-semibold text-accent-red-ink">{t('lifecyclePending')}</p>
                )}
              </div>

              {/* ── Same thing as another report ──
                  A <select> and not a search: with a hundred reports on the page
                  this is a short list of recent open ones, and merging is a thing
                  you do while looking at both. Choosing the empty option unmerges. */}
              <div className="pt-3 border-t border-page/50">
                <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-400">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  {t('mergeSection')}
                </label>
                <select
                  value={selected.duplicate_of || ''}
                  onChange={e => patch(selected.id, { duplicate_of: e.target.value || null })}
                  className="w-full rounded-lg border border-page/50 bg-page/50 px-3 py-2 text-sm text-ink-700 focus:outline-none focus:ring-1 focus:ring-brand-600/50"
                  dir="auto"
                >
                  <option value="">{t('mergeNone')}</option>
                  {mergeTargets.map(target => (
                    <option key={target.id} value={target.id}>
                      {target.message.slice(0, 50)} — {target.athlete_name.split(' ')[0]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-3 border-t border-page/50">
                <label className="text-xs font-semibold text-ink-400 mb-2 block">{t('adminNotes')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={adminNotes}
                    onChange={e => setAdminNotes(e.target.value)}
                    placeholder={t('addTagOrNote')}
                    className="flex-1 bg-page/50 border border-page/50 rounded-lg px-3 py-2 text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-1 focus:ring-brand-600/50"
                  />
                  <button
                    onClick={() => patch(selected.id, { admin_notes: adminNotes })}
                    disabled={updating === selected.id}
                    className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    {tc('save')}
                  </button>
                </div>
                {selected.admin_notes && adminNotes !== selected.admin_notes && (
                  <p className="text-3xs text-ink-400 mt-1.5">{t('currentNote', { note: selected.admin_notes })}</p>
                )}
              </div>

              {/* Archive is the primary close, and Delete is demoted to the quiet
                  end of the row. DELETE destroys the reason and the commit along
                  with the row, which is the opposite of what "I reported this
                  months ago" needs — it stays because a report containing somebody
                  else's personal details is a real reason to actually remove one. */}
              <div className="pt-3 border-t border-page/50 flex items-center justify-between gap-2">
                <button
                  onClick={() => patch(selected.id, { archived: !selected.archived_at })}
                  disabled={updating === selected.id}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-page px-3 text-xs font-semibold text-ink-500 transition-colors hover:bg-page/50 active:bg-page/50 disabled:opacity-50"
                >
                  {selected.archived_at
                    ? <><ArchiveRestore className="h-3.5 w-3.5" />{t('restore')}</>
                    : <><Archive className="h-3.5 w-3.5" />{t('archive')}</>}
                </button>
                <button
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={updating === selected.id}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-accent-red transition-all hover:bg-accent-red/10 active:bg-accent-red/10 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {tc('delete')}
                </button>
              </div>
            </div>
          </div>
        </Sheet>
      )}

      {/* A native ConfirmSheet, not the browser `confirm()` dialog (unstyleable,
          unlocalizable, not RTL-safe, and a jarring native alert on iOS). */}
      <ConfirmSheet
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={tc('delete')}
        description={t('deleteFeedbackConfirm')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        onConfirm={() => { if (selected) remove(selected.id); }}
      />

      {/* ── The five drawers ──
          Horizontally scrollable with the counts inside the chips: five Hebrew
          words do not fit a phone as a segmented control, and the count is the
          part that says which one needs you. Red on the inbox for the same
          reason — untriaged reports are the one number that means "today". */}
      <div className="-mx-4 mb-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-1.5">
          {FEEDBACK_VIEWS.map(v => {
            const on = view === v && !needle;
            const alert = v === 'inbox' && counts.inbox > 0;
            return (
              <button
                key={v}
                onClick={() => { setView(v); setQuery(''); }}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors',
                  on ? 'border-transparent bg-brand-600 text-white' : 'border-page/60 bg-card text-ink-400',
                )}
              >
                {t(VIEW_LABEL_KEY[v])}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-3xs font-bold tabular-nums',
                    on ? 'bg-white/25 text-white'
                      : alert ? 'bg-accent-red/15 text-accent-red-ink' : 'bg-page text-ink-400',
                  )}
                >
                  {counts[v]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-3 relative">
        <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-ink-400" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('feedbackSearch')}
          className="w-full rounded-xl bg-card border border-page/50 ps-9 pe-3 min-h-[44px] text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-1 focus:ring-brand-600/50"
        />
        {needle && (
          // A search leaves the drawers behind on purpose — otherwise "I reported
          // this months ago" comes back empty because the archive wasn't selected.
          <p className="mt-1.5 px-1 text-3xs font-semibold text-ink-400">{t('searchAllViews')}</p>
        )}
      </div>

      {/* Five labelled segments never fit a phone — "Training Feedback" alone is
          wider than the ~70px each one gets at 402px, and because a flex item
          can't shrink below its text the whole track ran off the screen. The four
          categories are their icons (named to a screen reader, and each report
          carries the same coloured icon in the list, so the mapping is on screen);
          "All" keeps its word, because that one isn't guessable from a glyph. */}
      <div className="mb-4">
        <SegmentedControl<FeedbackCategory | 'all'>
          value={filterCategory}
          onChange={setFilterCategory}
          options={[
            { value: 'all', label: t('all') },
            ...(['bug_report', 'feature_request', 'training_feedback', 'general'] as FeedbackCategory[]).map(cat => ({
              value: cat, label: catLabel(cat), icon: categoryConfig[cat].icon, iconOnly: true,
            })),
          ]}
        />
        {filterCategory !== 'all' && (
          // Which icon is selected, spelled out — an icon-only control leaves the
          // current filter unnamed, and "why is this list so short" is exactly the
          // question a silent filter causes.
          <p className="mt-1.5 text-center text-3xs font-semibold text-ink-400">{catLabel(filterCategory)}</p>
        )}
      </div>

      {/* Grouped by status inside the drawer. The drag-and-drop Kanban board this
          replaced didn't work at all on a phone: native HTML5 dragstart/drop
          events don't fire from touch input on iOS Safari. Status changes from
          the detail sheet. */}
      {loading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyState icon={MessageSquare} title={t('noFeedback')} />
      ) : visible.length === 0 ? (
        // Distinct from "no feedback": there ARE reports, this drawer or search
        // just doesn't match any, and saying "no feedback" there would be a lie.
        <EmptyState icon={Search} title={needle ? t('feedbackNoMatch') : t('viewEmpty')} />
      ) : (
        <div className="space-y-4">
          {FEEDBACK_STATUS_ORDER.map(status => {
            const rows = visible.filter(issue => normalizeStatus(issue.primary.status) === status);
            if (rows.length === 0) return null;
            return (
              <InsetSection key={status} header={`${statusLabel(status)} (${rows.length})`}>
                {rows.map(({ primary: item, duplicates, reporterCount }) => {
                  const catCfg = categoryConfig[item.category || 'general'];
                  const CatIcon = catCfg.icon;
                  const priCfg = priorityConfig[item.priority || 'medium'];
                  const date = new Date(item.created_at);
                  const timeAgo = (() => {
                    const h = (Date.now() - date.getTime()) / 3600000;
                    if (h < 1) return t('justNow');
                    if (h < 24) return t('hoursAgo', { hours: Math.floor(h) });
                    if (h < 48) return t('yesterday');
                    return dateLabel(item.created_at);
                  })();
                  // The screen it happened on, in the LIST — the single most
                  // useful triage field, and having to open each report to see
                  // it is what makes a list of bug reports feel like work.
                  const where = item.context?.pageLabel || item.context?.page || null;
                  return (
                    <button
                      key={item.id}
                      onClick={() => openReport(item)}
                      className="w-full text-start px-4 py-3 active:bg-page/40 transition-colors"
                    >
                      {/* flex-wrap + min-w-0: two chips side by side already
                          overflowed the card on the longer category names, and the
                          card has nothing to give — it's inside the inset list's
                          px-4. Wrapping is the only honest answer. */}
                      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        {/* The state on the ROW too, not only on the section header
                            above it. A row read mid-scroll — or after a search, where
                            the matches come from several sections — otherwise says
                            nothing about whether it was fixed. */}
                        <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-3xs font-bold', STATUS_PILL[normalizeStatus(item.status)])}>
                          {statusLabel(normalizeStatus(item.status))}
                        </span>
                        <span className={cn('flex min-w-0 items-center gap-1 text-3xs font-semibold px-1.5 py-0.5 rounded border', catCfg.bg, catCfg.border, catCfg.color)}>
                          <CatIcon className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{catLabel(item.category || 'general')}</span>
                        </span>
                        <span className={cn('shrink-0 text-3xs font-semibold px-1.5 py-0.5 rounded border', priCfg.bg, priCfg.border, priCfg.text)}>
                          {t(item.priority || 'medium')}
                        </span>
                        {/* The release that carries the fix, on the row — this is
                            the chip whose absence made a fixed bug look untouched.
                            dir="ltr" so "2.40.35" isn't reordered inside Hebrew. */}
                        {item.fixed_in_version && (
                          <span className="shrink-0 rounded border border-brand-600/25 bg-brand-600/10 px-1.5 py-0.5 font-mono text-3xs font-bold text-brand-700" dir="ltr">
                            {item.fixed_in_version}
                          </span>
                        )}
                        {item.verified_at && (
                          <span className="shrink-0 rounded border border-accent-600/30 bg-accent-600/15 px-1.5 py-0.5 text-3xs font-bold text-accent-900">
                            {t('verifiedByReporter')}
                          </span>
                        )}
                        {item.has_image && <Smartphone className="w-2.5 h-2.5 shrink-0 text-ink-400" />}
                      </div>
                      {/* break-words for the same reason as the sheet: a report is
                          often one pasted URL. line-clamp caps the height, not the
                          width of an unbreakable token. */}
                      <p className="text-sm text-ink-700 leading-relaxed line-clamp-2 break-words mb-1.5" dir="auto">{item.message}</p>
                      {duplicates.length > 0 && (
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <div className="flex">
                            {[item, ...duplicates].slice(0, 4).map((r, i) => (
                              <span
                                key={r.id}
                                className={cn(
                                  'flex h-[18px] w-[18px] items-center justify-center rounded-full border border-card bg-brand-600/10 text-[8px] font-bold text-brand-700',
                                  i > 0 && '-ms-1.5',
                                )}
                              >
                                {initials(r.athlete_name)}
                              </span>
                            ))}
                          </div>
                          <span className="text-3xs font-semibold text-ink-400">
                            {t('reportedByCount', { count: reporterCount })}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-3xs text-ink-400 font-medium">
                          {item.athlete_name.split(' ')[0]}
                          {where && <span className="text-ink-400/80"> · {where}</span>}
                        </span>
                        <span className="shrink-0 text-3xs text-ink-400">{timeAgo}</span>
                      </div>
                      {/* The night's verdict, clipped to one line on the row: the
                          point of the morning pass is accept-or-reject, and that
                          needs the reasoning visible without opening anything. */}
                      {item.triage_note && (
                        <p className="mt-1.5 line-clamp-2 rounded-lg bg-brand-600/5 px-2 py-1 text-3xs leading-relaxed text-brand-700 break-words" dir="auto">
                          {item.triage_note}
                        </p>
                      )}
                      {item.admin_notes && (
                        <p className="text-3xs text-ink-400 italic mt-1 border-t border-page/30 pt-1 break-words" dir="auto">{item.admin_notes}</p>
                      )}
                    </button>
                  );
                })}
              </InsetSection>
            );
          })}
        </div>
      )}
    </>
  );
}
