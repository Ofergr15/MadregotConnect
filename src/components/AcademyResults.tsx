'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trophy, Pencil, Trash2, X, Medal, Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseTime, formatTime } from '@/lib/academy/benchmark';
import { apiHeaders } from '@/lib/api';
import { Spinner, SkeletonList, EmptyState, Sheet, Button, ConfirmSheet } from '@/components/ui';

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
  rank === 1 ? 'text-band-3' : rank === 2 ? 'text-ink-500' : rank === 3 ? 'text-band-3' : 'text-ink-400';

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
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

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
        method: 'PATCH', headers: await apiHeaders(true),
        body: JSON.stringify({ id, action }),
      });
      fetchResults();
    } catch { fetchResults(); }
  };

  const openNew = () => { setEditing({ test_name: test }); setTimeText(''); setError(null); };
  const openEdit = (r: Result) => { setEditing(r); setTimeText(formatTime(r.time_seconds)); setError(null); };

  const save = async () => {
    if (!editing?.athlete_name?.trim()) { setError('שם הספורטאי/ת נדרש'); return; }
    const secs = parseTime(timeText);
    if (secs == null) { setError('הזמן צריך להיראות כמו 5:46.96 או 6:03'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/benchmarks', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({
          id: editing.id,
          testName: editing.test_name || test,
          athleteName: editing.athlete_name.trim(),
          timeSeconds: secs,
          notes: editing.notes || null,
          recordedOn: editing.recorded_on || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'השמירה נכשלה'); }
      setEditing(null);
      fetchResults();
    } catch (err: any) {
      setError(err.message || 'השמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
    try { await fetch(`/api/academy/benchmarks?id=${id}`, { method: 'DELETE', headers: await apiHeaders() }); }
    catch { fetchResults(); }
  };

  const shown = results.filter(r => r.test_name === test);

  if (loading) return <SkeletonList count={4} />;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Pending approval queue — athlete submissions that would rank top-3 */}
      {pending.length > 0 && (
        <div className="bg-band-3/10 border border-band-3/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-band-3" />
            <h3 className="text-sm font-bold text-band-3">מחכים לאישור ({pending.length})</h3>
          </div>
          <div className="space-y-1.5">
            {pending.map(p => (
              <div key={p.id} className="flex items-center gap-3 bg-page/40 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-700 truncate" dir="auto">{p.athlete_name} <span className="text-ink-400">· {p.test_name}</span></div>
                  {p.notes && <div className="text-xs text-ink-400 truncate" dir="auto">{p.notes}</div>}
                </div>
                <span className="text-sm font-bold text-ink-700 tabular-nums">{formatTime(p.time_seconds)}</span>
                <button onClick={() => moderate(p.id, 'approve')} className="p-2.5 rounded-lg text-accent-900 hover:bg-accent-600/15 min-h-[44px] min-w-[44px]" title="אישור"><Check className="h-4 w-4" /></button>
                <button onClick={() => moderate(p.id, 'reject')} className="p-2.5 rounded-lg text-accent-red hover:bg-accent-red/15 min-h-[44px] min-w-[44px]" title="דחייה"><X className="h-4 w-4" /></button>
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
              className="bg-page border border-page rounded-lg px-3 h-9 text-sm text-ink-700"
            >
              {tests.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
              <Trophy className="h-4 w-4 text-band-3" /> {test}
            </span>
          )}
          <span className="text-xs text-ink-400">{shown.length} תוצאות</span>
        </div>
        <Button onClick={openNew} size="sm">
          <Plus className="h-4 w-4" /> הוספת תוצאה
        </Button>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="עדיין אין תוצאות"
          description="הוספת תוצאת מבחן תבנה את לוח המקומות."
        />
      ) : (
        <div className="space-y-1.5">
          {shown.map(r => (
            <div key={r.id} className="flex items-center gap-3 bg-card/50 border border-page/50 rounded-xl p-3">
              <div className="w-7 text-center shrink-0">
                {r.rank && r.rank <= 3
                  ? <Medal className={cn('h-5 w-5 mx-auto', medalColor(r.rank))} />
                  : <span className="text-sm font-bold text-ink-400">{r.rank ?? '–'}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink-700 text-sm truncate flex items-center gap-2" dir="auto">
                  {r.athlete_name}
                  {r.athlete_id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-600/15 text-accent-900">מקושר</span>}
                </div>
                {r.notes && <div className="text-xs text-ink-400 truncate" dir="auto">{r.notes}</div>}
              </div>
              <div className="text-base font-bold text-ink-700 tabular-nums shrink-0">{formatTime(r.time_seconds)}</div>
              <button onClick={() => openEdit(r)} className="p-2.5 rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page min-h-[44px] min-w-[44px]"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => setDeleteTarget(r.id)} className="p-2.5 rounded-lg text-ink-400 hover:text-accent-red active:text-accent-red hover:bg-accent-red/10 active:bg-accent-red/10 min-h-[44px] min-w-[44px]"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Add/edit sheet */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? 'עריכת תוצאה' : 'הוספת תוצאה'}>
        <div className="space-y-3">
          <Field label="מבחן">
            <input value={editing?.test_name || test} onChange={e => setEditing(prev => ({ ...prev, test_name: e.target.value }))}
              className="w-full bg-page border border-page rounded-lg px-3 h-11 text-sm text-ink-700" placeholder="2000m" />
          </Field>
          <Field label="שם הספורטאי/ת">
            <input value={editing?.athlete_name || ''} onChange={e => setEditing(prev => ({ ...prev, athlete_name: e.target.value }))}
              dir="auto" className="w-full bg-page border border-page rounded-lg px-3 h-11 text-sm text-ink-700" placeholder="שם מלא" />
          </Field>
          <Field label="זמן (m:ss.ss)">
            <input value={timeText} onChange={e => setTimeText(e.target.value)} dir="ltr"
              className="w-full bg-page border border-page rounded-lg px-3 h-11 text-sm text-ink-700 tabular-nums" placeholder="5:46.96" />
          </Field>
          <Field label="הערות (לא חובה)">
            <input value={editing?.notes || ''} onChange={e => setEditing(prev => ({ ...prev, notes: e.target.value }))}
              dir="auto" className="w-full bg-page border border-page rounded-lg px-3 h-11 text-sm text-ink-700" placeholder="" />
          </Field>
          {error && <p className="text-xs text-accent-red">{error}</p>}
          <Button className="w-full" disabled={saving} onClick={save}>
            {saving && <Spinner size={16} />} שמירה
          </Button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="מחיקת תוצאה"
        description="לא ניתן לשחזר את התוצאה לאחר המחיקה."
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        onConfirm={() => { if (deleteTarget) remove(deleteTarget); }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
