'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MessageSquare, Trash2, Bug, Lightbulb, Dumbbell, MessageCircle, Search, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';
import { reviewContextRows, type ReviewContext } from '@/lib/review-context';
import { Sheet, ConfirmSheet, SegmentedControl, EmptyState, LoadingBlock } from '@/components/ui';
import { InsetSection } from '@/components/ui/InsetList';

/**
 * The staff side of /dashboard/review: every report the club has filed, and the
 * triage controls for them.
 *
 * ── WHY IT'S A COMPONENT AND NOT A SCREEN ──────────────────────────────────
 * This UI lived inline in the Settings page's "Feedback" tab, which is four taps
 * deep behind a grid of eleven management tabs — so in practice the reports
 * arrived and nobody read them (every report in prod is still `status = 'new'`).
 * It now has its own destination at /dashboard/feedback, linked straight from
 * the review screen, while Settings keeps its tab by rendering this same
 * component. One implementation, two entry points: the alternative was a second
 * copy of the status/priority/notes logic, which is exactly how the desktop nav
 * and the tab bar drifted apart before.
 *
 * Everything here is staff-only by virtue of the API: GET/PATCH/DELETE
 * /api/feedback all call requireStaff, so a non-staff caller gets an empty list
 * rather than a hidden-but-fetchable one.
 */

type FeedbackCategory = 'feature_request' | 'bug_report' | 'training_feedback' | 'general';
type FeedbackStatus = 'new' | 'idea' | 'sprint' | 'denied' | 'done';
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
  image_url: string | null;
  created_at: string;
  /** Auto-collected diagnostics (migration 093) — see src/lib/review-context.ts.
   *  Null on every report filed before that shipped, so it renders conditionally. */
  context: ReviewContext | null;
}

const categoryConfig = {
  feature_request: { label: 'Feature Request', icon: Lightbulb, color: 'text-purple-800', bg: 'bg-purple-500/15', border: 'border-purple-500/30' },
  bug_report: { label: 'Bug Report', icon: Bug, color: 'text-accent-red-ink', bg: 'bg-accent-red/15', border: 'border-accent-red/30' },
  training_feedback: { label: 'Training Feedback', icon: Dumbbell, color: 'text-band-2-ink', bg: 'bg-band-2/15', border: 'border-band-2/30' },
  general: { label: 'General', icon: MessageCircle, color: 'text-teal-600', bg: 'bg-teal-500/15', border: 'border-teal-500/30' },
};

const priorityConfig = {
  low: { label: 'Low', bg: 'bg-band-2/15', text: 'text-band-2-ink', border: 'border-band-2/30' },
  medium: { label: 'Medium', bg: 'bg-band-3/15', text: 'text-band-3-ink', border: 'border-band-3/30' },
  high: { label: 'High', bg: 'bg-accent-red/15', text: 'text-accent-red-ink', border: 'border-accent-red/30' },
};

const STATUS_ORDER: FeedbackStatus[] = ['new', 'idea', 'sprint', 'denied', 'done'];

export function FeedbackAdmin() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [filterCategory, setFilterCategory] = useState<FeedbackCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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

  const updateStatus = async (id: string, status: FeedbackStatus, priority: FeedbackPriority, notes?: string) => {
    // Optimistic, because triaging is a rapid-fire activity: the segmented
    // control has to answer the tap, not the round trip.
    setItems(prev => prev.map(f => f.id === id ? { ...f, status, priority, admin_notes: notes ?? f.admin_notes } : f));
    if (selected && selected.id === id) {
      setSelected({ ...selected, status, priority, admin_notes: notes ?? selected.admin_notes });
    }
    try {
      const body: Record<string, unknown> = { id, status, priority };
      if (notes !== undefined) body.admin_notes = notes;
      await fetch('/api/feedback', { method: 'PATCH', headers: await apiHeaders(true), body: JSON.stringify(body) });
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

  // The search runs over the message, the reporter and their group — the three
  // things you actually have when someone says "I reported this last week".
  const needle = query.trim().toLowerCase();
  const visible = items.filter(item => {
    if (filterCategory !== 'all' && (item.category || 'general') !== filterCategory) return false;
    if (!needle) return true;
    return [item.message, item.athlete_name, item.athlete_email, item.group_name]
      .some(v => (v || '').toLowerCase().includes(needle));
  });
  const newCount = items.filter(i => (i.status || 'new') === 'new').length;

  return (
    <>
      {selected && (
        <Sheet open onOpenChange={(o) => { if (!o) { setSelected(null); setConfirmDeleteOpen(false); } }}>
          <div className="pb-4 mb-1 border-b border-page/50 flex items-center">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-brand-600/15 flex items-center justify-center">
                <span className="text-sm font-bold text-brand-600">
                  {selected.athlete_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </span>
              </div>
              <div>
                <p className="text-base font-bold text-ink-700">{selected.athlete_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {selected.athlete_email && <span className="text-xs text-ink-400">{selected.athlete_email}</span>}
                  {selected.group_name && <span className="text-xs text-ink-400">· {selected.group_name}</span>}
                </div>
              </div>
            </div>
          </div>
          <div className="pt-4">
            <div className="flex items-center gap-2 mb-4">
              {(() => {
                const catConfig = categoryConfig[selected.category || 'general'];
                const CatIcon = catConfig.icon;
                return (
                  <span className={cn('flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border', catConfig.bg, catConfig.border, catConfig.color)}>
                    <CatIcon className="w-3.5 h-3.5" />
                    {catConfig.label}
                  </span>
                );
              })()}
              <span className="text-xs text-ink-400">
                {new Date(selected.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="text-base text-ink-700 leading-relaxed whitespace-pre-wrap mb-4">{selected.message}</p>
            {selected.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.image_url} alt="Attached" className="max-h-48 rounded-lg border border-page/50 mb-5" />
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
                      <dd className="min-w-0 flex-1 font-medium text-ink-700" dir="auto">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              );
            })()}

            <div className="border-t border-page/50 pt-4 space-y-4">
              <div className={cn(updating === selected.id && 'opacity-50 pointer-events-none')}>
                <label className="text-xs font-semibold text-ink-400 mb-2 block">{t('status')}</label>
                <SegmentedControl<FeedbackStatus>
                  value={selected.status || 'new'}
                  onChange={(status) => updateStatus(selected.id, status, selected.priority || 'medium')}
                  options={STATUS_ORDER.map(status => ({ value: status, label: t(status) }))}
                />
              </div>
              <div className={cn(updating === selected.id && 'opacity-50 pointer-events-none')}>
                <label className="text-xs font-semibold text-ink-400 mb-2 block">{t('priority')}</label>
                <SegmentedControl<FeedbackPriority>
                  value={selected.priority || 'medium'}
                  onChange={(priority) => updateStatus(selected.id, selected.status || 'new', priority)}
                  options={(['low', 'medium', 'high'] as FeedbackPriority[]).map(priority => ({ value: priority, label: t(priority) }))}
                />
              </div>
              {updating === selected.id && (
                <div className="flex items-center gap-2 text-xs text-ink-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t('updating')}
                </div>
              )}

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
                    onClick={() => updateStatus(selected.id, selected.status || 'new', selected.priority || 'medium', adminNotes)}
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

              <div className="pt-3 border-t border-page/50 flex justify-end">
                <button
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={updating === selected.id}
                  className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold text-accent-red hover:bg-accent-red/10 active:bg-accent-red/10 border border-accent-red/20 hover:border-accent-red/40 transition-all disabled:opacity-50"
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

      {/* How much is waiting, and how much of it nobody has looked at — the one
          number that says whether this screen needs attention today. */}
      <div className="mb-3 flex items-center gap-2">
        <p className="text-2xs font-semibold text-ink-400">{t('feedbackCount', { count: items.length })}</p>
        {newCount > 0 && (
          <span className="rounded-full bg-accent-red/15 px-2 py-0.5 text-3xs font-bold text-accent-red-ink">
            {t('feedbackNewCount', { count: newCount })}
          </span>
        )}
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
      </div>

      <div className="mb-4">
        <SegmentedControl<FeedbackCategory | 'all'>
          value={filterCategory}
          onChange={setFilterCategory}
          options={[
            { value: 'all', label: t('all') },
            ...(['bug_report', 'feature_request', 'training_feedback', 'general'] as FeedbackCategory[]).map(cat => ({
              value: cat, label: categoryConfig[cat].label, icon: categoryConfig[cat].icon,
            })),
          ]}
        />
      </div>

      {/* Grouped by status. The drag-and-drop Kanban board this replaced didn't
          work at all on a phone: native HTML5 dragstart/drop events don't fire
          from touch input on iOS Safari. Status changes from the detail sheet. */}
      {loading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyState icon={MessageSquare} title={t('noFeedback')} />
      ) : visible.length === 0 ? (
        // Distinct from "no feedback": there ARE reports, this filter/search just
        // doesn't match any, and saying "no feedback" there would be a lie.
        <EmptyState icon={Search} title={t('feedbackNoMatch')} />
      ) : (
        <div className="space-y-4">
          {STATUS_ORDER.map(status => {
            const colItems = visible.filter(item => (item.status || 'new') === status);
            if (colItems.length === 0) return null;
            return (
              <InsetSection key={status} header={`${t(status)} (${colItems.length})`}>
                {colItems.map(item => {
                  const catCfg = categoryConfig[item.category || 'general'];
                  const CatIcon = catCfg.icon;
                  const priCfg = priorityConfig[item.priority || 'medium'];
                  const date = new Date(item.created_at);
                  const timeAgo = (() => {
                    const h = (Date.now() - date.getTime()) / 3600000;
                    if (h < 1) return t('justNow');
                    if (h < 24) return t('hoursAgo', { hours: Math.floor(h) });
                    if (h < 48) return t('yesterday');
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  })();
                  // The screen it happened on, in the LIST — the single most
                  // useful triage field, and having to open each report to see
                  // it is what makes a list of bug reports feel like work.
                  const where = item.context?.pageLabel || item.context?.page || null;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setSelected(item); setAdminNotes(item.admin_notes || ''); }}
                      className="w-full text-start px-4 py-3 active:bg-page/40 transition-colors"
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className={cn('flex items-center gap-1 text-3xs font-semibold px-1.5 py-0.5 rounded border', catCfg.bg, catCfg.border, catCfg.color)}>
                          <CatIcon className="w-2.5 h-2.5" />{catCfg.label}
                        </span>
                        <span className={cn('text-3xs font-semibold px-1.5 py-0.5 rounded border', priCfg.bg, priCfg.border, priCfg.text)}>
                          {t(item.priority || 'medium')}
                        </span>
                        {item.image_url && <Smartphone className="w-2.5 h-2.5 text-ink-400" />}
                      </div>
                      <p className="text-sm text-ink-700 leading-relaxed line-clamp-2 mb-1.5">{item.message}</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-3xs text-ink-400 font-medium">
                          {item.athlete_name.split(' ')[0]}
                          {where && <span className="text-ink-400/80"> · {where}</span>}
                        </span>
                        <span className="shrink-0 text-3xs text-ink-400">{timeAgo}</span>
                      </div>
                      {item.admin_notes && (
                        <p className="text-3xs text-ink-400 italic mt-1 border-t border-page/30 pt-1">{item.admin_notes}</p>
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
