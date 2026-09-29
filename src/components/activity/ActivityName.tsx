'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { fetchFeedItemByActivity, updateFeedItem } from '@/lib/feed-client';

/**
 * The run's name on its own page, renamable by its owner (feedback #92).
 *
 * "שם האימון לא ניתן לעריכה" — and on this page it could not even be SEEN: the
 * header showed the weekday, and the only rename field lived in the share editor
 * behind an unlabelled share icon. So the name is printed here, and its owner gets
 * a pencil.
 *
 * No new endpoint. The save goes through the same PATCH on the run's feed item that
 * the share editor already uses — author-checked there, and writing
 * `athlete_activities.activity_name` scoped to the caller's own athlete id. Every
 * activity has that item (the trigger from migration 047 creates it), and a re-sync
 * does not undo the rename, because both syncs upsert with `ignoreDuplicates`.
 */
const MAX_LENGTH = 80;

export function ActivityName({
  activityId,
  name,
  editable,
}: {
  activityId: string;
  name: string | null;
  editable: boolean;
}) {
  const t = useTranslations('activities');
  const tc = useTranslations('common');
  const [saved, setSaved] = useState(name ?? '');
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const save = async () => {
    const next = (draft ?? '').trim();
    if (!next || next === saved) {
      setDraft(null);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const { item } = await fetchFeedItemByActivity(activityId);
      await updateFeedItem(item.id, { activityName: next });
      setSaved(next);
      setDraft(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (draft !== null) {
    return (
      <div className="mt-0.5">
        <div className="flex items-center gap-1">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={e => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') setDraft(null);
            }}
            autoFocus
            dir="auto"
            aria-label={t('activityName')}
            placeholder={t('activityNamePlaceholder')}
            className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-brand-600 bg-card px-2.5 text-sm font-semibold text-ink-700 outline-none"
          />
          <button
            onClick={() => void save()}
            disabled={busy}
            aria-label={tc('save')}
            className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg text-brand-600 hover:bg-brand-600/10"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setDraft(null)}
            disabled={busy}
            aria-label={tc('cancel')}
            className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg text-ink-400 hover:bg-page"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="mt-1 text-2xs text-accent-red">{t('renameError')}</p>}
      </div>
    );
  }

  if (!saved && !editable) return null;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <p className="truncate text-sm font-semibold text-ink-700" dir="auto">
        {saved || t('activityNamePlaceholder')}
      </p>
      {editable && (
        <button
          onClick={() => setDraft(saved)}
          aria-label={t('renameAction')}
          title={t('renameAction')}
          className="grid min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-page hover:text-ink-700"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
