'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trophy, Medal, Plus, Loader2, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseTime, formatTime } from '@/lib/academy/benchmark';

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
  rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-orange-400' : 'text-slate-500';

/**
 * Profile "Your Best": shows the athlete's approved results and lets them submit
 * or update a time. A submission that would rank top-3 is held for admin approval.
 */
export function ProfileBest({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const [results, setResults] = useState<Result[]>([]);
  const [pending, setPending] = useState<Result[]>([]);
  const [tests, setTests] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ test: string; time: string } | null>(null);
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
    if (secs == null) { setError('Time must look like 5:46.96 or 6:03'); return; }
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch('/api/academy/benchmarks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testName: form.test,
          athleteName: athleteName,
          timeSeconds: secs,
          athleteId: athleteId || undefined,
          submittedBy: athleteId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submit failed');
      setForm(null);
      setMsg(data.pending
        ? 'Submitted! A top-3 time needs coach approval before it appears.'
        : 'Result saved.');
      load();
    } catch (err: any) {
      setError(err.message || 'Submit failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;
  // Only show the section if there's something to show OR the athlete is registered (can submit).
  if (!athleteId && results.length === 0) return null;

  return (
    <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-yellow-400" />
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Your Best</h2>
        </div>
        {athleteId && (
          <button
            onClick={() => { setForm({ test: tests[0] || '2000m', time: '' }); setMsg(null); setError(null); }}
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-primary-600/20 text-primary-300 hover:bg-primary-600/30 text-xs font-semibold"
          >
            <Plus className="h-3.5 w-3.5" /> Submit time
          </button>
        )}
      </div>

      {msg && <p className="text-xs text-emerald-400 mb-3">{msg}</p>}

      {results.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-slate-500">No results yet. Submit a test time to get on the board.</p>
      ) : (
        <div className="space-y-2">
          {results.map(r => (
            <div key={r.id} className="flex items-center gap-3 bg-slate-900/50 rounded-xl p-3">
              <div className="shrink-0">
                {r.rank && r.rank <= 3
                  ? <Medal className={cn('h-5 w-5', medalColor(r.rank))} />
                  : <span className="text-sm font-bold text-slate-500 w-5 text-center inline-block">{r.rank ?? '–'}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white">{r.test_name}</div>
                <div className="text-xs text-slate-400">{r.rank ? `Rank #${r.rank}` : 'Recorded'}{r.notes ? ` · ${r.notes}` : ''}</div>
              </div>
              <div className="text-lg font-black text-white tabular-nums shrink-0">{formatTime(r.time_seconds)}</div>
            </div>
          ))}
          {pending.map(r => (
            <div key={r.id} className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <Clock className="h-4 w-4 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white">{r.test_name}</div>
                <div className="text-xs text-amber-400/80">Awaiting coach approval (top-3 time)</div>
              </div>
              <div className="text-lg font-black text-white tabular-nums shrink-0">{formatTime(r.time_seconds)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Submit modal */}
      {form && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white">Submit a time</h3>
              <button onClick={() => setForm(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Test</label>
                <select value={form.test} onChange={e => setForm({ ...form, test: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 h-10 text-sm text-white">
                  {tests.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Your time (m:ss.ss)</label>
                <input value={form.time} onChange={e => setForm({ ...form, time: e.target.value })}
                  placeholder="5:46.96" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 h-10 text-sm text-white tabular-nums" />
              </div>
              <p className="text-xs text-slate-500">A time that would rank in the top 3 is sent to your coach for approval first.</p>
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-700">
              <button onClick={() => setForm(null)} className="px-3 h-10 rounded-lg text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
              <button onClick={submit} disabled={saving}
                className="flex items-center gap-2 px-4 h-10 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
