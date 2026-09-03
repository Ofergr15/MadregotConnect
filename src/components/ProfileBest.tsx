'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trophy, Medal, Plus, Loader2, Clock, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { parseTime, formatTime } from '@/lib/academy/benchmark';
import { apiHeaders } from '@/lib/api';
import { Sheet, InsetSection, InsetRow } from '@/components/ui';

interface Result {
  id: string;
  test_name: string;
  athlete_name: string;
  time_seconds: number;
  notes: string | null;
  status?: string;
  rank: number | null;
}

const medalColor = (rank: number) =>
  rank === 1 ? 'text-band-3' : rank === 2 ? 'text-ink-500' : rank === 3 ? 'text-band-3' : 'text-ink-400';

/**
 * Profile "Your Best": shows the athlete's approved results and lets them submit
 * or update a time. A submission that would rank top-3 is held for admin approval.
 */
export function ProfileBest({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const t = useTranslations('profileBest');
  const [results, setResults] = useState<Result[]>([]);
  const [pending, setPending] = useState<Result[]>([]);
  const [tests, setTests] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ test: string; time: string } | null>(null);
  const [testPickerOpen, setTestPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Approved results for this athlete (by id, name fallback for imported rows).
      let data: any = null;
      if (athleteId) data = await (await fetch(`/api/academy/benchmarks?athleteId=${athleteId}`)).json();
      if ((!data || !data.results?.length) && athleteName)
        data = await (await fetch(`/api/academy/benchmarks?name=${encodeURIComponent(athleteName)}`)).json();
      setResults(data?.results || []);

      // The athlete's own pending submissions.
      const pend = await (await fetch(`/api/academy/benchmarks?status=pending&name=${encodeURIComponent(athleteName)}`)).json();
      setPending(pend?.results || []);

      // Available tests (from the approved board / settings).
      const all = await (await fetch('/api/academy/benchmarks')).json();
      setTests(all?.tests?.length ? all.tests : ['2000m']);
    } catch {
      /* optional section */
    } finally {
      setLoading(false);
    }
  }, [athleteId, athleteName]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form) return;
    const secs = parseTime(form.time);
    if (secs == null) { setError(t('timeFormatError')); return; }
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch('/api/academy/benchmarks', {
        method: 'POST', headers: await apiHeaders(true),
        body: JSON.stringify({
          testName: form.test,
          athleteName: athleteName,
          timeSeconds: secs,
          athleteId: athleteId || undefined,
          submittedBy: athleteId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || t('submitFailed'));
      setForm(null);
      setMsg(data.pending
        ? t('submittedPending')
        : t('resultSaved'));
      load();
    } catch (err: any) {
      setError(err.message || t('submitFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;
  // Only show the section if there's something to show OR the athlete is registered (can submit).
  if (!athleteId && results.length === 0) return null;

  return (
    <div className="rounded-card bg-card/80 border border-page/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-band-3" />
          <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wider">{t('title')}</h2>
        </div>
        {athleteId && (
          <button
            onClick={() => { setForm({ test: tests[0] || '2000m', time: '' }); setMsg(null); setError(null); }}
            className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-brand-600/20 text-brand-600 hover:bg-brand-600/30 text-xs font-semibold"
          >
            <Plus className="h-3.5 w-3.5" /> {t('submitTimeButton')}
          </button>
        )}
      </div>

      {msg && <p className="text-xs text-accent-600 mb-3">{msg}</p>}

      {results.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-ink-400">{t('noResultsYet')}</p>
      ) : (
        <div className="space-y-2">
          {results.map(r => (
            <div key={r.id} className="flex items-center gap-3 bg-page/50 rounded-xl p-3">
              <div className="shrink-0">
                {r.rank && r.rank <= 3
                  ? <Medal className={cn('h-5 w-5', medalColor(r.rank))} />
                  : <span className="text-sm font-bold text-ink-400 w-5 text-center inline-block">{r.rank ?? '–'}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink-700">{r.test_name}</div>
                <div className="text-xs text-ink-400">{r.rank ? t('rankLabel', { rank: r.rank }) : t('recorded')}{r.notes ? ` · ${r.notes}` : ''}</div>
              </div>
              <div className="text-lg font-black text-ink-700 tabular-nums shrink-0">{formatTime(r.time_seconds)}</div>
            </div>
          ))}
          {pending.map(r => (
            <div key={r.id} className="flex items-center gap-3 bg-band-3/10 border border-band-3/20 rounded-xl p-3">
              <Clock className="h-4 w-4 text-band-3 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink-700">{r.test_name}</div>
                <div className="text-xs text-band-3/80">{t('awaitingApproval')}</div>
              </div>
              <div className="text-lg font-black text-ink-700 tabular-nums shrink-0">{formatTime(r.time_seconds)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Submit sheet — native bottom sheet, not a centered web dialog */}
      <Sheet
        open={!!form}
        onOpenChange={(o) => { if (!o) setForm(null); }}
        title={t('submitATime')}
        footer={
          <div className="space-y-2 px-4 pb-4 pt-1">
            <button
              onClick={submit}
              disabled={saving}
              className="w-full min-h-[48px] rounded-xl font-bold text-base bg-brand-600 hover:bg-brand-700 text-white transition-colors active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('submit')}
            </button>
            <button
              onClick={() => setForm(null)}
              className="w-full min-h-[48px] rounded-xl font-semibold text-base bg-page hover:bg-ink-300/40 text-ink-700 transition-colors active:scale-[0.98]"
            >
              {t('cancel')}
            </button>
          </div>
        }
      >
        {form && (
          <div className="space-y-3">
            <InsetSection>
              <InsetRow
                label={t('testLabel')}
                value={form.test}
                onClick={() => setTestPickerOpen(true)}
              />
            </InsetSection>
            <div>
              <label className="block text-xs font-medium text-ink-400 mb-1.5">{t('yourTimeLabel')}</label>
              <input value={form.time} onChange={e => setForm({ ...form, time: e.target.value })}
                placeholder="5:46.96" className="w-full bg-page border border-page rounded-lg px-3 min-h-[44px] text-sm text-ink-700 tabular-nums" />
            </div>
            <p className="text-xs text-ink-400">{t('topThreeNote')}</p>
            {error && <p className="text-xs text-accent-red">{error}</p>}
          </div>
        )}
      </Sheet>

      {/* Test picker — iOS value-picker sheet, replacing the raw <select> */}
      <Sheet open={testPickerOpen} onOpenChange={setTestPickerOpen} title={t('selectTest')}>
        <InsetSection>
          {tests.map(testName => (
            <InsetRow
              key={testName}
              label={testName}
              onClick={() => { setForm(f => (f ? { ...f, test: testName } : f)); setTestPickerOpen(false); }}
              trailing={form?.test === testName ? <CheckCircle2 className="h-5 w-5 text-brand-600" /> : undefined}
            />
          ))}
        </InsetSection>
      </Sheet>
    </div>
  );
}
