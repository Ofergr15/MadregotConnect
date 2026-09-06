'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import {
  Send, CheckCircle2, Bug, Lightbulb, Dumbbell, MessageCircle, Camera, Images, X,
  ChevronDown, ChevronLeft, Info, MapPin, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { Button, Spinner, Sheet, InsetSection, InsetRow } from '@/components/ui';
import { useNavItems } from '@/lib/nav-items';
import {
  collectReviewContext, compressImage, dataUrlBytes, formatBytes,
  reviewContextRows, REVIEW_DRAFT_KEY, REVIEW_LAST_PATH_KEY, type ReviewContext,
} from '@/lib/review-context';

/**
 * /dashboard/review — the club's "something isn't working" channel.
 *
 * ── WHAT CHANGED AND WHY ────────────────────────────────────────────────────
 * This was a centered marketing header over a textarea and a four-way segmented
 * control, and it produced reports that couldn't be acted on: one sentence, no
 * screen, no app version, no device — and screenshots big enough to fail
 * silently on the very screen whose job is to report failures.
 *
 * Four things changed, each of them the answer to a specific way the old screen
 * wasted the reporter's effort:
 *
 * 1. The category is FOUR TAPPABLE CARDS, bug first, each with a one-line hint.
 *    A phone-width segmented control with four Hebrew labels was unreadable, and
 *    it opened on "general", which is the one answer that tells us nothing.
 * 2. The screen it happened on is PREFILLED from where they just came from (the
 *    (app) layout leaves a breadcrumb) and changeable from a list. Nobody should
 *    have to describe a route in prose.
 * 3. Device, app version, viewport and PWA-vs-tab are collected automatically
 *    and SHOWN, collapsed, before sending. Attaching them silently would be a
 *    small betrayal; not attaching them costs an hour per report.
 * 4. The report SURVIVES. A draft is kept in localStorage until it sends, a
 *    failure keeps the text instead of clearing it, and the reporter can see
 *    their own past reports and what happened to them — a report whose fate you
 *    can't see is indistinguishable from one nobody read.
 */

type FeedbackCategory = 'bug_report' | 'feature_request' | 'training_feedback' | 'general';

const CATEGORIES = [
  // Bug first, and the default. This screen exists because things break; the
  // most common reason to open it should be the one already selected.
  { value: 'bug_report' as const, labelKey: 'bugReport', hintKey: 'bugHint', icon: Bug, tint: 'text-accent-red', bg: 'bg-accent-red/10' },
  { value: 'feature_request' as const, labelKey: 'featureRequest', hintKey: 'featureHint', icon: Lightbulb, tint: 'text-purple-600', bg: 'bg-purple-600/10' },
  { value: 'training_feedback' as const, labelKey: 'trainingFeedback', hintKey: 'trainingHint', icon: Dumbbell, tint: 'text-band-2-ink', bg: 'bg-band-2/15' },
  { value: 'general' as const, labelKey: 'general', hintKey: 'generalHint', icon: MessageCircle, tint: 'text-teal-600', bg: 'bg-teal-600/10' },
];

/** Which categories are about a SCREEN. Training feedback isn't, and asking
 *  "where did it happen" about the paces would just be noise. */
const ASKS_WHERE: FeedbackCategory[] = ['bug_report', 'feature_request'];

const STATUS_KEY: Record<string, string> = {
  new: 'statusNew', idea: 'statusIdea', sprint: 'statusSprint', done: 'statusDone', denied: 'statusDenied',
};
const STATUS_STYLE: Record<string, string> = {
  new: 'bg-brand-600/10 text-brand-600',
  idea: 'bg-purple-600/10 text-purple-600',
  sprint: 'bg-band-3/20 text-band-3-ink',
  done: 'bg-accent-600/15 text-accent-900',
  denied: 'bg-page text-ink-400',
};

interface MyReport {
  id: string;
  message: string;
  category: FeedbackCategory;
  status: string | null;
  created_at: string;
}

export default function ReviewPage() {
  const t = useTranslations('review');
  const tn = useTranslations('nav');
  const locale = useLocale();

  const [category, setCategory] = useState<FeedbackCategory>('bug_report');
  const [message, setMessage] = useState('');
  const [page, setPage] = useState<string | null>(null);
  const [pageAuto, setPageAuto] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wherePickerOpen, setWherePickerOpen] = useState(false);

  const [athleteName, setAthleteName] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const { data: groupsData } = useApi<{ groups?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>(
    groupId ? '/api/groups' : null,
  );
  const groupName =
    (Array.isArray(groupsData) ? groupsData : groupsData?.groups || []).find(g => g.id === groupId)?.name || '';

  // The reachable screens, from the same resolver the nav uses — so the picker
  // can only ever offer somewhere this account can actually go.
  const { navItems } = useNavItems();
  const screenOptions = useMemo(
    () => navItems.filter(i => i.tab !== 'review').map(i => ({ href: i.href, label: tn(i.labelKey as any) })),
    [navItems, tn],
  );
  const pageLabel = useMemo(
    () => screenOptions.find(o => o.href === page)?.label || null,
    [screenOptions, page],
  );

  const { data: mineData, mutate: refreshMine } = useApi<{ feedback?: MyReport[] }>('/api/feedback?mine=1');
  const myReports = mineData?.feedback || [];

  // ── Mount: identity, the breadcrumb, and any unsent draft ──────────────────
  useEffect(() => {
    setAthleteName(localStorage.getItem('athlete_name') || '');
    setGroupId(localStorage.getItem('athlete_group_id'));

    let draftPage: string | null = null;
    try {
      const raw = localStorage.getItem(REVIEW_DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { message?: string; category?: FeedbackCategory; page?: string | null };
        if (d.message?.trim()) {
          setMessage(d.message);
          setDraftRestored(true);
          if (d.category) setCategory(d.category);
          draftPage = d.page ?? null;
        }
      }
    } catch { /* corrupt draft — ignore it rather than block the screen */ }

    // The draft's own screen wins if it had one; otherwise fall back to wherever
    // they were standing when they opened this page.
    if (draftPage) {
      setPage(draftPage);
    } else {
      try {
        const last = sessionStorage.getItem(REVIEW_LAST_PATH_KEY);
        if (last) { setPage(last); setPageAuto(true); }
      } catch { /* private mode */ }
    }
  }, []);

  // ── Draft autosave ─────────────────────────────────────────────────────────
  // Cheap and synchronous: the payload is a few hundred bytes and the alternative
  // is losing a typed report to a backgrounded PWA, which is exactly the kind of
  // thing this screen is for reporting.
  useEffect(() => {
    try {
      if (message.trim()) {
        localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({ message, category, page }));
      } else {
        localStorage.removeItem(REVIEW_DRAFT_KEY);
      }
    } catch { /* quota / private mode */ }
  }, [message, category, page]);

  const discardDraft = () => {
    setMessage('');
    setDraftRestored(false);
    try { localStorage.removeItem(REVIEW_DRAFT_KEY); } catch { /* ignore */ }
  };

  // ── The auto-collected context ─────────────────────────────────────────────
  const [ctx, setCtx] = useState<ReviewContext | null>(null);
  const asksWhere = ASKS_WHERE.includes(category);
  useEffect(() => {
    setCtx(collectReviewContext({
      // Only stamp the screen when the category is actually about one.
      page: asksWhere ? page : null,
      pageLabel: asksWhere ? pageLabel : null,
      locale,
    }));
  }, [page, pageLabel, locale, asksWhere]);

  const contextRows = reviewContextRows(ctx, {
    page: t('ctxPage'), version: t('ctxVersion'), device: t('ctxDevice'),
    screen: t('ctxScreen'), mode: t('ctxMode'),
  });

  const handleFile = useCallback(async (file: File) => {
    setImageError(false);
    if (!file.type.startsWith('image/')) return;
    try {
      setImagePreview(await compressImage(file));
    } catch {
      setImageError(true);
    }
  }, []);

  const placeholder =
    category === 'bug_report' ? t('placeholderBug')
      : category === 'feature_request' ? t('placeholderFeature')
        : category === 'training_feedback' ? t('placeholderTraining')
          : t('placeholder');

  const handleSubmit = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(false);
    try {
      // Identity (athlete, name, email, squad) is stamped server-side from the
      // session — `athleteName`/`groupName` below are only for the "filing as …"
      // line this screen shows.
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({
          message: message.trim(),
          category,
          image: imagePreview || undefined,
          // Re-collected at send time rather than reused from state: viewport and
          // timestamp should describe the moment the report was filed.
          context: collectReviewContext({
            page: asksWhere ? page : null,
            pageLabel: asksWhere ? pageLabel : null,
            locale,
          }),
        }),
      });
      if (!res.ok) { setError(true); return; }
      // Only clear on success. A failed send used to be indistinguishable from a
      // successful one for the text: both left the box as it was, but nothing
      // told the athlete which had happened.
      setSent(true);
      setMessage('');
      setImagePreview(null);
      setDraftRestored(false);
      try { localStorage.removeItem(REVIEW_DRAFT_KEY); } catch { /* ignore */ }
      refreshMine();
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  };

  const imageBytes = imagePreview ? dataUrlBytes(imagePreview) : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-700">{t('title')}</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-400">{t('subtitle')}</p>
      </div>

      {sent ? (
        /* A confirmation SCREEN, not a toast that vanishes after four seconds.
           The old banner auto-hid, so the one moment the athlete was looking for
           reassurance was also the moment it disappeared. */
        <div className="rounded-card bg-card p-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-600/15">
            <CheckCircle2 className="h-6 w-6 text-accent-900" />
          </span>
          <p className="text-base font-bold text-ink-700">{t('sentTitle')}</p>
          <p className="mx-auto mt-1.5 max-w-[300px] text-sm leading-relaxed text-ink-400">{t('sentBody')}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => { setSent(false); setCategory('bug_report'); }}>
              {t('sendAnother')}
            </Button>
            <Link href="/feed">
              <Button variant="ghost">{tn('feed')}</Button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {draftRestored && (
            <div className="flex items-center gap-2.5 rounded-card bg-card px-4 py-3">
              <RotateCcw className="h-4 w-4 shrink-0 text-ink-400" />
              <span className="flex-1 text-xs font-medium text-ink-700">{t('draftRestored')}</span>
              <button onClick={discardDraft} className="shrink-0 text-xs font-bold text-accent-red">
                {t('draftDiscard')}
              </button>
            </div>
          )}

          {/* ── 1. What kind of report ── */}
          <div>
            <SectionCaption>{t('categoryQuestion')}</SectionCaption>
            <div className="grid grid-cols-2 gap-2.5">
              {CATEGORIES.map((c) => {
                const active = category === c.value;
                const Icon = c.icon;
                return (
                  <button
                    key={c.value}
                    onClick={() => {
                      if (active) return;
                      try { navigator.vibrate?.(6); } catch { /* no-op */ }
                      setCategory(c.value);
                    }}
                    aria-pressed={active}
                    className={cn(
                      'flex min-h-[92px] flex-col items-start gap-1.5 rounded-card p-3.5 text-start transition-all active:scale-[0.97]',
                      // The selected card is stated with a ring and not a fill:
                      // each category already owns a colour, and filling the card
                      // with it made the four look like four different controls.
                      active ? 'bg-card ring-2 ring-brand-600' : 'bg-card',
                    )}
                  >
                    <span className={cn('flex h-8 w-8 items-center justify-center rounded-full', c.bg)}>
                      <Icon className={cn('h-4 w-4', c.tint)} />
                    </span>
                    <span className="text-13 font-bold leading-tight text-ink-900">{t(c.labelKey as any)}</span>
                    <span className="text-3xs leading-snug text-ink-400">{t(c.hintKey as any)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 2. Which screen (bug / idea only) ── */}
          {asksWhere && (
            <div>
              <SectionCaption>{t('whereQuestion')}</SectionCaption>
              <button
                onClick={() => setWherePickerOpen(true)}
                className="flex min-h-[56px] w-full items-center gap-2.5 rounded-card bg-card px-4 text-start active:bg-page/40"
              >
                <MapPin className="h-4 w-4 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-900">
                    {pageLabel || page || t('whereAny')}
                  </span>
                  {/* Saying it was detected is what makes a wrong guess harmless:
                      the athlete can see it's an assumption and correct it. */}
                  {pageAuto && page && (
                    <span className="block text-3xs text-ink-400">{t('whereAuto')}</span>
                  )}
                </span>
                <ChevronLeft className="h-4 w-4 shrink-0 text-ink-400" />
              </button>
            </div>
          )}

          {/* ── 3. The report ── */}
          <div>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={placeholder}
              rows={6}
              className="w-full resize-none rounded-card bg-card px-4 py-3.5 text-sm leading-relaxed text-ink-900 placeholder-ink-400 transition-all focus:outline-none focus:ring-2 focus:ring-brand-600/40"
            />

            {/* ── 4. Screenshot ── */}
            {imagePreview ? (
              <div className="mt-2.5 flex items-center gap-3 rounded-card bg-card p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="text-13 font-semibold text-ink-900">{t('attached')}</p>
                  {/* The size, because it's the reassurance that the 4 MB photo
                      they just picked was shrunk and will actually arrive. */}
                  {/* dir="auto" — inside the RTL page "184 KB" otherwise renders
                      as "KB 184", the unit leading the number. */}
                  <p className="text-3xs text-ink-400" dir="auto">{formatBytes(imageBytes)}</p>
                  <button onClick={() => setPickerOpen(true)} className="mt-1 text-3xs font-bold text-brand-600">
                    {t('changeScreenshot')}
                  </button>
                </div>
                <button
                  onClick={() => setImagePreview(null)}
                  aria-label={t('removeScreenshot')}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-400 active:bg-page"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="mt-2.5 flex min-h-[52px] w-full items-center gap-2.5 rounded-card bg-card px-4 text-start active:bg-page/40"
              >
                <Camera className="h-4 w-4 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink-900">{t('attachScreenshot')}</span>
                  <span className="block text-3xs text-ink-400">{t('attachHint')}</span>
                </span>
              </button>
            )}
            {imageError && <p className="mt-2 text-xs text-accent-red">{t('imageFailed')}</p>}
          </div>

          {/* ── 5. What we attach automatically ── */}
          {contextRows.length > 0 && (
            <div className="overflow-hidden rounded-card bg-card">
              <button
                onClick={() => setShowContext(v => !v)}
                aria-expanded={showContext}
                className="flex min-h-[48px] w-full items-center gap-2.5 px-4 text-start active:bg-page/40"
              >
                <Info className="h-4 w-4 shrink-0 text-ink-400" />
                <span className="flex-1 text-13 font-medium text-ink-700">{t('contextTitle')}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-400 transition-transform', showContext && 'rotate-180')} />
              </button>
              {showContext && (
                <div className="border-t border-page px-4 py-3">
                  <p className="mb-2 text-3xs leading-relaxed text-ink-400">{t('contextHint')}</p>
                  <dl className="space-y-1.5">
                    {contextRows.map(r => (
                      <div key={r.label} className="flex items-baseline gap-2 text-3xs">
                        <dt className="w-20 shrink-0 text-ink-400">{r.label}</dt>
                        <dd className="min-w-0 flex-1 truncate font-medium text-ink-700" dir="auto">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          )}

          {/* ── 6. Send ── */}
          <div className="space-y-2">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={handleSubmit}
              disabled={!message.trim() || sending}
            >
              {sending ? <Spinner size={16} /> : <Send className="h-4 w-4" />}
              {t('send')}
            </Button>
            <p className="text-center text-3xs text-ink-400">
              <span className="font-medium text-ink-500">{athleteName || t('anonymous')}</span>
              {groupName && <span> · {groupName}</span>}
            </p>
            {error && <p className="text-center text-sm leading-relaxed text-accent-red">{t('submitError')}</p>}
          </div>
        </>
      )}

      {/* ── My past reports ── */}
      {myReports.length > 0 && (
        <div className="pt-2">
          <SectionCaption>{t('myReports')}</SectionCaption>
          <div className="overflow-hidden rounded-card bg-card">
            {myReports.map((r, i) => {
              const status = r.status || 'new';
              return (
                <div key={r.id} className={cn('px-4 py-3', i < myReports.length - 1 && 'border-b border-page')}>
                  <div className="flex items-center gap-2">
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-3xs font-bold', STATUS_STYLE[status] || STATUS_STYLE.new)}>
                      {t((STATUS_KEY[status] || 'statusNew') as any)}
                    </span>
                    <span className="text-3xs text-ink-400">
                      {new Date(r.created_at).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-13 leading-snug text-ink-700" dir="auto">{r.message}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Screen picker */}
      <Sheet open={wherePickerOpen} onOpenChange={setWherePickerOpen} title={t('wherePick')}>
        <div className="space-y-1 pb-2">
          <button
            onClick={() => { setPage(null); setPageAuto(false); setWherePickerOpen(false); }}
            className={cn(
              'flex min-h-[44px] w-full items-center rounded-xl px-4 text-start text-sm font-semibold active:bg-page/50',
              page === null ? 'text-brand-600' : 'text-ink-700',
            )}
          >
            {t('whereAny')}
          </button>
          {screenOptions.map(o => (
            <button
              key={o.href}
              onClick={() => { setPage(o.href); setPageAuto(false); setWherePickerOpen(false); }}
              className={cn(
                'flex min-h-[44px] w-full items-center rounded-xl px-4 text-start text-sm font-semibold active:bg-page/50',
                page === o.href ? 'text-brand-600' : 'text-ink-700',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Sheet>

      {/* Camera / library action sheet — an HTML dropzone has no iOS equivalent. */}
      <Sheet open={pickerOpen} onOpenChange={setPickerOpen} title={t('attachScreenshot')}>
        <InsetSection>
          <InsetRow
            icon={Camera}
            iconBg="bg-brand-600"
            label={t('takePhoto')}
            onClick={() => { setPickerOpen(false); cameraInputRef.current?.click(); }}
          />
          <InsetRow
            icon={Images}
            iconBg="bg-ink-300"
            label={t('chooseFromLibrary')}
            onClick={() => { setPickerOpen(false); libraryInputRef.current?.click(); }}
          />
        </InsetSection>
      </Sheet>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />
    </div>
  );
}

function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 px-2 text-3xs font-semibold uppercase tracking-[0.09em] text-ink-400">{children}</p>
  );
}
