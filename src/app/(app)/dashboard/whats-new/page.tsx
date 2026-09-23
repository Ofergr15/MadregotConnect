'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { CheckCircle2, Pencil, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { Sheet, Spinner } from '@/components/ui';
import { splitByApproval, type ApprovalRow, type ShownNote, type WhatsNewRelease } from '@/lib/release-notes';

interface Data {
  staff: boolean;
  appVersion: string;
  releases: WhatsNewRelease[];
  pending: ShownNote[];
  mainSha?: string | null;
  deployedSha?: string | null;
  approval?: ApprovalRow | null;
}

/**
 * Every release, one row a day — and, for the owner, the next release: he
 * approves it (nothing ships at 05:00 without that), stars which notes get a row
 * in the "What's new" sheet (none until he does), and rewords them. See
 * src/lib/release-notes.ts.
 */
export default function WhatsNewPage() {
  const t = useTranslations('whatsNew');
  const locale = useLocale();
  const { data, isLoading, mutate } = useApi<Data>('/api/whats-new');
  const [editing, setEditing] = useState<ShownNote | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);

  const decide = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    await fetch('/api/whats-new', {
      method,
      headers: await apiHeaders(true),
      body: method === 'POST' ? JSON.stringify({ sha: data?.mainSha }) : undefined,
    }).catch(() => {});
    await mutate();
    setBusy(false);
  };

  const save = async (note: ShownNote, patch: { featured?: boolean; title?: string; body?: string }) => {
    // Optimistic: flip it here, then let the refetch settle it.
    mutate(d => d && ({
      ...d,
      pending: d.pending.map(n => n.id === note.id ? { ...n, ...patch } : n),
      releases: d.releases.map(r => ({ ...r, notes: r.notes.map(n => n.id === note.id ? { ...n, ...patch } : n) })),
    }), false);
    await fetch('/api/whats-new', {
      method: 'PATCH',
      headers: await apiHeaders(true),
      body: JSON.stringify({ note_id: note.id, ...patch }),
    }).catch(() => {});
    mutate();
  };

  const day = (iso: string) => new Date(iso).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem',
  });

  if (isLoading || !data) return <div className="flex justify-center py-16"><Spinner /></div>;

  const NoteRow = ({ n, pickable }: { n: ShownNote; pickable: boolean }) => (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600/10 text-base">{n.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink-900">
          {n.title}
          {n.kind === 'fix' && <span className="ms-1.5 rounded bg-page px-1.5 py-0.5 text-2xs font-semibold text-ink-500">{t('fix')}</span>}
          {n.audience === 'staff' && <span className="ms-1.5 rounded bg-page px-1.5 py-0.5 text-2xs font-semibold text-ink-500">{t('staffOnly')}</span>}
        </p>
        <p className="mt-0.5 text-13 leading-snug text-ink-500">{n.body}</p>
      </div>
      {pickable && (
        <div className="flex shrink-0 items-center">
          <button
            aria-label={t('edit')}
            onClick={() => { setEditing(n); setDraft({ title: n.title, body: n.body }); }}
            className="flex h-11 w-11 items-center justify-center text-ink-400 active:text-brand-600"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            role="switch"
            aria-checked={n.featured}
            aria-label={t('feature')}
            onClick={() => save(n, { featured: !n.featured })}
            className={cn('flex h-11 w-11 items-center justify-center rounded-xl', n.featured ? 'text-amber-500' : 'text-ink-300')}
          >
            <Star className={cn('h-5 w-5', n.featured && 'fill-current')} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="pb-10">
      <h1 className="mb-1 text-2xl font-black text-ink-900">{t('title')}</h1>
      <p className="mb-5 text-13 text-ink-500">{t('pageLead')}</p>

      {data.staff && (() => {
        const approval = data.approval ?? null;
        const { approved, waiting } = splitByApproval(data.pending, approval);
        // Something to approve: new notes, or new commits with no notes at all.
        const canApprove = !!data.mainSha && data.mainSha !== approval?.sha
          && (waiting.length > 0 || (!approval && data.mainSha !== data.deployedSha));
        const time = approval && new Date(approval.approved_at).toLocaleTimeString('he-IL', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
        });
        return (
          <section className="mb-6">
            <p className="mb-1.5 px-4 text-2xs font-bold text-ink-400">{t('nextRelease')}</p>
            <div className={cn(
              'mb-2 flex items-center gap-3 rounded-card px-4 py-3',
              approval ? 'bg-emerald-50 text-emerald-800' : 'bg-card text-ink-700',
            )}>
              {approval && <CheckCircle2 className="h-5 w-5 shrink-0" />}
              <p className="min-w-0 flex-1 text-13 font-semibold leading-snug">
                {approval ? t('approvedAt', { time: time ?? '' }) : t('notApproved')}
              </p>
              {approval && (
                <button disabled={busy} onClick={() => decide('DELETE')} className="min-h-[44px] shrink-0 px-2 text-13 font-bold text-accent-red">
                  {t('withdraw')}
                </button>
              )}
            </div>
            {approved.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-card bg-card divide-y divide-page">
                {approved.map(n => <NoteRow key={n.id} n={n} pickable />)}
              </div>
            )}
            {waiting.length > 0 && (
              <>
                {approval && <p className="mb-1.5 mt-3 px-4 text-2xs font-bold text-ink-400">{t('afterApproval')}</p>}
                <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
                  {waiting.map(n => <NoteRow key={n.id} n={n} pickable />)}
                </div>
              </>
            )}
            {data.pending.length === 0 && !canApprove && (
              <p className="rounded-card bg-card px-4 py-4 text-13 text-ink-400">{t('nothingPending')}</p>
            )}
            {canApprove && (
              <button
                disabled={busy}
                onClick={() => decide('POST')}
                className="mt-3 h-12 w-full rounded-2xl bg-brand-600 text-base font-extrabold text-white disabled:opacity-60"
              >
                {approval ? t('approveAgain', { count: data.pending.length }) : t('approve', { count: data.pending.length })}
              </button>
            )}
            <p className="mt-2 px-4 text-2xs leading-relaxed text-ink-400">{t('pickHint')}</p>
          </section>
        );
      })()}

      {!data.releases.some(r => r.notes.length > 0) && !data.staff && (
        <p className="px-4 py-8 text-center text-13 text-ink-400">{t('noReleases')}</p>
      )}
      {/* A day whose only notes were staff tools is not a day a member saw change. */}
      {data.releases.filter(r => r.notes.length > 0).map((r, i) => {
        const featured = r.notes.filter(n => n.featured);
        const rest = r.notes.filter(n => !n.featured);
        return (
          <section key={r.id} className="mb-5">
            <p className="mb-1.5 flex justify-between px-4 text-2xs font-bold text-ink-400">
              <span>{day(r.released_at)}{i === 0 && <span className="ms-1.5 rounded bg-brand-600/10 px-1.5 text-brand-700">{t('latest')}</span>}</span>
              <span className="font-mono" dir="ltr">{r.app_version}</span>
            </p>
            <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
              {featured.map(n => <NoteRow key={n.id} n={n} pickable={data.staff} />)}
              {rest.length > 0 && (data.staff
                ? rest.map(n => <NoteRow key={n.id} n={n} pickable />)
                : (
                  <div className="px-4 py-3 text-13 text-ink-500">
                    {featured.length > 0 && <span className="font-semibold">{t('andFixes', { count: rest.length })}: </span>}
                    {rest.map(n => n.title).join(' · ')}
                  </div>
                ))}
            </div>
          </section>
        );
      })}

      <Sheet open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }} title={t('editTitle')}>
        {editing && (
          <div className="space-y-3 px-1 pb-2">
            <input
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              maxLength={80}
              aria-label={t('fieldTitle')}
              className="h-12 w-full rounded-xl bg-page px-3 text-base font-bold text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40"
            />
            <textarea
              value={draft.body}
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
              maxLength={300}
              rows={4}
              aria-label={t('fieldBody')}
              className="w-full resize-none rounded-xl bg-page px-3 py-2.5 text-base leading-relaxed text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-600/40"
            />
            <button
              onClick={async () => { const n = editing; setEditing(null); await save(n, { title: draft.title, body: draft.body }); }}
              className="h-12 w-full rounded-2xl bg-brand-600 text-base font-extrabold text-white"
            >
              {t('save')}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
