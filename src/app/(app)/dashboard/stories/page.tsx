'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { BackNav, SkeletonList } from '@/components/ui';

// "סיפורים" — phase 1 of the stories gate (migration 156): the weekly summary's state
// and the shared tester list. Birthday still has its own switch on /dashboard/birthdays.
// The full admin (audience, per-person overrides, preview) is phase 2.

type State = 'off' | 'self' | 'testers' | 'all';
interface Tester { athleteId: string; name: string | null; status: string | null }
interface Data { ready: boolean; paused: boolean; settings: { feature: string; state: State }[]; testers: Tester[] }
interface Athlete { id: string; name: string | null; status?: string | null }

const STATES: Array<[State, string, string]> = [
  ['off', 'כבוי', 'אף אחד לא מקבל'],
  ['self', 'רק אני', 'רק אדמין רואה, לתצוגה. בלי התראות'],
  ['testers', 'בדיקה', 'רק הבודקים: התראה בשבת 18:00 וכרטיס בפיד'],
  ['all', 'כולם', 'כל המועדון: התראה בשבת 18:00 וכרטיס בפיד'],
];

export default function StoriesAdminPage() {
  const router = useRouter();
  const { data, mutate } = useApi<Data>('/api/admin/stories');
  const { data: roster } = useApi<{ athletes: Athlete[] }>('/api/athletes');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const weekly = data?.settings.find((s) => s.feature === 'weekly')?.state ?? 'off';

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      await fetch(url, { method, headers: await apiHeaders(true), body: body ? JSON.stringify(body) : undefined });
      await mutate();
    } finally {
      setBusy(false);
    }
  };

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const taken = new Set((data?.testers || []).map((t) => t.athleteId));
    return (roster?.athletes || [])
      .filter((a) => a.status === 'active' && !taken.has(a.id) && (a.name || '').toLowerCase().includes(term))
      .slice(0, 6);
  }, [q, roster, data]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-2" dir="rtl">
      <BackNav label="תוכן" onBack={() => router.push('/dashboard/content')} />
      <h1 className="mt-2 text-[28px] font-black text-ink-900">סיפורים</h1>
      <p className="mt-1 text-sm leading-relaxed text-ink-400">מי מקבל את סיכום השבוע. סגור כברירת מחדל: אם משהו לא נקרא, אף אחד לא מקבל.</p>

      {!data ? <SkeletonList /> : !data.ready ? (
        <p className="mt-4 rounded-card bg-card px-4 py-3 text-sm text-ink-500">מיגרציה 156 עוד לא הודבקה. עד אז סיכום השבוע כבוי לכולם.</p>
      ) : (
        <>
          {data.paused && <p className="mt-4 rounded-card bg-accent-red/10 px-4 py-3 text-sm font-bold text-accent-red">כל הסיפורים מושהים (stories_paused)</p>}

          <section className="mt-4 rounded-card bg-card px-4 py-3">
            <b className="block text-[15px] font-extrabold text-ink-900">📅 סיכום שבועי</b>
            <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-page p-1" role="radiogroup" aria-label="מצב סיכום שבועי">
              {STATES.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={weekly === v}
                  disabled={busy}
                  onClick={() => weekly !== v && call('/api/admin/stories', 'PUT', { feature: 'weekly', state: v })}
                  className={cn('min-h-[40px] rounded-lg text-sm font-bold', weekly === v ? 'bg-brand-600 text-white' : 'text-ink-500')}
                >
                  {label}
                </button>
              ))}
            </div>
            <small className="mt-2 block text-xs text-ink-400">{STATES.find(([v]) => v === weekly)?.[2]}</small>
          </section>

          <section className="mt-4 rounded-card bg-card px-4 py-3">
            <b className="block text-[15px] font-extrabold text-ink-900">בודקים · {data.testers.length}</b>
            <small className="block text-xs text-ink-400">רשימה אחת לכל הסיפורים. נכנסת לתוקף רק כשהמצב ״בדיקה״.</small>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.testers.map((t) => (
                <span key={t.athleteId} className="inline-flex items-center gap-1 rounded-full bg-page px-3 py-1 text-sm text-ink-900">
                  {t.name || t.athleteId.slice(0, 8)}{t.status !== 'active' && <em className="text-xs text-accent-red not-italic"> · לא פעיל</em>}
                  <button type="button" aria-label={`הסר ${t.name || ''}`} disabled={busy} onClick={() => call(`/api/admin/stories/testers?athleteId=${t.athleteId}`, 'DELETE')} className="p-1 text-ink-400">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="הוסף בודק: חפש שם"
              className="mt-3 min-h-[44px] w-full rounded-xl bg-page px-3 text-sm text-ink-900"
            />
            {matches.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                onClick={async () => { await call('/api/admin/stories/testers', 'POST', { athleteId: a.id }); setQ(''); }}
                className="mt-1 block min-h-[44px] w-full rounded-xl px-3 text-start text-sm text-ink-900 hover:bg-page"
              >
                + {a.name}
              </button>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
