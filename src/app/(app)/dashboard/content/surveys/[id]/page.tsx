'use client';

import { use, useState } from 'react';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { SurveyResultsView, type SurveyResultsData } from '@/components/content/SurveyResults';
import { useContentLevels } from '@/components/content/use-hub';

// One poll, for the staff — the view is components/content/SurveyResults.tsx (shared with
// /preview/polls for screenshots); this page reads it and does the two actions.
export default function SurveyResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { levels } = useContentLevels();
  const { data, error, mutate } = useApi<SurveyResultsData>(`/api/admin/content/surveys/${encodeURIComponent(id)}`, { refreshInterval: 30_000 });
  const [busy, setBusy] = useState<'remind' | 'close' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  if (error) return <p className="py-10 text-center text-sm text-ink-400">לא מצאתי את הסקר.</p>;
  if (!data) return <p role="status" className="py-10 text-center text-sm text-ink-400">טוען…</p>;

  const act = async (action: 'remind' | 'close') => {
    setBusy(action); setNote(null);
    try {
      const res = await fetch(`/api/admin/content/surveys/${encodeURIComponent(id)}`, { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ action }) });
      const out = (await res.json().catch(() => ({}))) as { sent?: number };
      if (!res.ok) throw new Error();
      setNote(action === 'remind' ? `התזכורת יצאה ל-${out.sent ?? 0}` : 'הסקר נסגר');
      await mutate();
    } catch { setNote('לא הצלחתי. נסו שוב.'); } finally { setBusy(null); setConfirmClose(false); }
  };
  const copy = async (names: string[]) => {
    try { await navigator.clipboard.writeText(names.join('\n')); setNote('השמות הועתקו'); } catch { setNote('לא הצלחתי להעתיק'); }
  };

  return <SurveyResultsView data={data} busy={busy} note={note} confirmClose={confirmClose}
    onAskClose={() => setConfirmClose(true)} onRemind={() => act('remind')} onClose={() => act('close')} onCopy={copy}
    readOnly={!!levels && (levels.surveys ?? 0) < 3} />;
}
