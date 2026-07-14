'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trophy, Pencil, Trash2, X, Medal, Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseTime, formatTime } from '@/lib/academy/benchmark';

interface Result {
  id: string;
  test_name: string;
  athlete_name: string;
  athlete_id: string | null;
  time_seconds: number;
  notes: string | null;
  recorded_on: string | null;
  status?: string;
  rank: number | null;
}

const medalColor = (rank: number) =>
  rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-orange-400' : 'text-slate-600';

export function AcademyResults() {
  const [results, setResults] = useState<Result[]>([]);
  const [pending, setPending] = useState<Result[]>([]);
  const [tests, setTests] = useState<string[]>([]);
  const [test, setTest] = useState('2000m');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Result> | null>(null);
  const [timeText, setTimeText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const [approvedRes, pendingRes] = await Promise.all([
        fetch('/api/academy/benchmarks'),
        fetch('/api/academy/benchmarks?status=pending'),
      ]);
      const data = await approvedRes.json();
      const pend = await pendingRes.json();
      setResults(data.results || []);
      setPending(pend.results || []);
      const t: string[] = data.tests && data.tests.length ? data.tests : ['2000m'];
      setTests(t);
      setTest(prev => (t.includes(prev) ? prev : t[0]));
    } catch (err) {
      console.error('Failed to fetch results:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  const moderate = async (id: string, action: 'approve' | 'reject') => {
    setPending(prev => prev.filter(p => p.id !== id));
    try {
      await fetch('/api/academy/benchmarks', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      fetchResults();
    } catch { fetchResults(); }
  };

  const openNew = () => { setEditing({ test_name: test }); setTimeText(''); setError(null); };
  const openEdit = (r: Result) => { setEditing(r); setTimeText(formatTime(r.time_seconds)); setError(null); };

  const save = async () => {
    if (!editing?.athlete_name?.trim()) { setError('Name is required'); return; }
    const secs = parseTime(timeText);
    if (secs == null) { setError('Time must look like 5:46.96 or 6:03'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/benchmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          testName: editing.test_name || test,
          athleteName: editing.athlete_name.trim(),
          timeSeconds: secs,
          notes: editing.notes || null,
          recordedOn: editing.recorded_on || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Save failed'); }
      setEditing(null);
      fetchResults();
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this result?')) return;
    setResults(prev => prev.filter(r => r.id !== id));
    try { await fetch(`/api/academy/benchmarks?id=${id}`, { method: 'DELETE' }); }
    catch { fetchResults(); }
  };

  const shown = results.filter(r => r.test_name === test);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-7 w-7 text-primary-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Pending approval queue — athlete submissions that would rank top-3 */}
      {pending.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold text-amber-300">Pending approval ({pending.length})</h3>
          </div>
          <div className="space-y-1.5">
            {pending.map(p => (
              <div key={p.id} className="flex items-center gap-3 bg-slate-900/40 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate" dir="auto">{p.athlete_name} <span className="text-slate-500">· {p.test_name}</span></div>
                  {p.notes && <div className="text-xs text-slate-500 truncate" dir="auto">{p.notes}</div>}
                </div>
                <span className="text-sm font-bold text-white tabular-nums">{formatTime(p.time_seconds)}</span>
                <button onClick={() => moderate(p.id, 'approve')} className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/15" title="Approve"><Check className="h-4 w-4" /></button>
                <button onClick={() => moderate(p.id, 'reject')} className="p-2 rounded-lg text-red-400 hover:bg-red-500/15" title="Reject"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {tests.length > 1 ? (
            <select
              value={test}
              onChange={e => setTest(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 h-9 text-sm text-white"
            >
              {tests.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <Trophy className="h-4 w-4 text-yellow-400" /> {test}
            </span>
          )}
          <span className="text-xs text-slate-500">{shown.length} results</span>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 h-9 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold"
        >
          <Plus className="h-4 w-4" /> Add result
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl p-10 text-center">
          <Trophy className="h-9 w-9 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">No results yet</p>
          <p className="text-sm text-slate-500 mt-1">Add a test result to build the leaderboard.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {shown.map(r => (
            <div key={r.id} className="flex items-center gap-3 bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
              <div className="w-7 text-center shrink-0">
                {r.rank && r.rank <= 3
                  ? <Medal className={cn('h-5 w-5 mx-auto', medalColor(r.rank))} />
                  : <span className="text-sm font-bold text-slate-500">{r.rank ?? '–'}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white text-sm truncate flex items-center gap-2" dir="auto">
                  {r.athlete_name}
                  {r.athlete_id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">linked</span>}
                </div>
                {r.notes && <div className="text-xs text-slate-500 truncate" dir="auto">{r.notes}</div>}
              </div>
              <div className="text-base font-bold text-white tabular-nums shrink-0">{formatTime(r.time_seconds)}</div>
              <button onClick={() => openEdit(r)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => remove(r.id)} className="p-2 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Add/edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-lg font-bold text-white">{editing.id ? 'Edit result' : 'Add result'}</h2>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <Field label="Test">
                <input value={editing.test_name || test} onChange={e => setEditing({ ...editing, test_name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 h-10 text-sm text-white" placeholder="2000m" />
              </Field>
              <Field label="Athlete name">
                <input value={editing.athlete_name || ''} onChange={e => setEditing({ ...editing, athlete_name: e.target.value })}
                  dir="auto" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 h-10 text-sm text-white" placeholder="שם מלא" />
              </Field>
              <Field label="Time (m:ss.ss)">
                <input value={timeText} onChange={e => setTimeText(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 h-10 text-sm text-white tabular-nums" placeholder="5:46.96" />
              </Field>
              <Field label="Notes (optional)">
                <input value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })}
                  dir="auto" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 h-10 text-sm text-white" placeholder="" />
              </Field>
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-700">
              <button onClick={() => setEditing(null)} className="px-3 h-10 rounded-lg text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-2 px-4 h-10 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
