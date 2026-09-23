'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Pencil, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { Sheet, Spinner } from '@/components/ui';
import type { ShownNote, WhatsNewRelease } from '@/lib/release-notes';

interface Data {
  staff: boolean;
  appVersion: string;
  releases: WhatsNewRelease[];
  pending: ShownNote[];
}

/**
 * Every release, one row a day — and, for the owner, tomorrow's release with
 * the day's pick: which notes get the big card in the "What's new" sheet, and
 * in what words. See src/lib/release-notes.ts.
 */
export default function WhatsNewPage() {
  const t = useTranslations('whatsNew');
  const locale = useLocale();
  const { data, isLoading, mutate } = useApi<Data>('/api/whats-new');
  const [editing, setEditing] = useState<ShownNote | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '' });

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

      {data.staff && (
        <section className="mb-6">
          <p className="mb-1.5 px-4 text-2xs font-bold text-ink-400">{t('tomorrow')}</p>
          <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
            {data.pending.length === 0
              ? <p className="px-4 py-4 text-13 text-ink-400">{t('nothingPending')}</p>
              : data.pending.map(n => <NoteRow key={n.id} n={n} pickable />)}
          </div>
          <p className="mt-2 px-4 text-2xs leading-relaxed text-ink-400">{t('pickHint')}</p>
        </section>
      )}

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
