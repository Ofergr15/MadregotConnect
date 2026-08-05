'use client';

import { useState, useEffect } from 'react';
import { Construction, Loader2, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';

// Admin control: the "under renovation" gate on/off + the allowlist of emails
// allowed during maintenance. Split into a compact inset ROW (so it can share a
// grouped card with other settings rows, like the reference design) and a
// separate ALLOWLIST card shown only when maintenance is on. Both read the same
// SWR-cached /api/maintenance, so state stays in sync from one fetch.
interface MaintenanceData { maintenance: boolean; allowlist: string[] }

function actorEmail() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
}

// One inset row: colored construction glyph + label + inline toggle.
export function MaintenanceRow() {
  const { data, mutate } = useApi<MaintenanceData>('/api/maintenance');
  const [saving, setSaving] = useState(false);
  const on = data?.maintenance ?? null;

  const toggle = async () => {
    if (on == null) return;
    setSaving(true);
    // Optimistic flip in the shared cache; confirm with the server.
    mutate({ maintenance: !on, allowlist: data?.allowlist ?? [] }, false);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: !on, actorEmail: actorEmail() }),
      });
      const d = await res.json();
      if (res.ok) mutate({ maintenance: !!d.maintenance, allowlist: d.allowlist ?? data?.allowlist ?? [] }, false);
      else mutate(); // revalidate → roll back
    } catch { mutate(); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
      <span className={cn('shrink-0 w-7 h-7 rounded-md flex items-center justify-center', on ? 'bg-amber-500' : 'bg-slate-600')}>
        <Construction className="h-4 w-4 text-white" />
      </span>
      <div className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium text-white" dir="rtl">מצב תחזוקה</span>
        <span className="block text-2xs text-slate-400" dir="rtl">{on ? 'רק מורשים רואים את האפליקציה' : 'האפליקציה פתוחה לכולם'}</span>
      </div>
      <button onClick={toggle} disabled={saving || on == null}
        className={cn('relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50', on ? 'bg-green-500' : 'bg-slate-600')}
        aria-label="Toggle maintenance mode">
        {saving
          ? <Loader2 className="w-4 h-4 animate-spin text-white absolute inset-0 m-auto" />
          : <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white transition-all', on ? 'start-6' : 'start-1')} />}
      </button>
    </div>
  );
}

// The allowlist editor — its own card, shown only while maintenance is on.
export function MaintenanceAllowlist() {
  const { data, mutate } = useApi<MaintenanceData>('/api/maintenance');
  const [pick, setPick] = useState('');
  const [saving, setSaving] = useState(false);
  const [athletes, setAthletes] = useState<Array<{ name: string; email: string }>>([]);
  const on = data?.maintenance ?? false;
  const allowlist = data?.allowlist ?? [];

  useEffect(() => {
    fetch('/api/admin/users').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.users) setAthletes(d.users.filter((u: any) => u.email).map((u: any) => ({ name: u.name || u.email, email: u.email })));
    }).catch(() => {});
  }, []);

  const persistAllowlist = async (next: string[]) => {
    setSaving(true);
    mutate({ maintenance: on, allowlist: next }, false); // optimistic
    try {
      const res = await fetch('/api/maintenance', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowlist: next, actorEmail: actorEmail() }),
      });
      const d = await res.json();
      if (res.ok) mutate({ maintenance: !!d.maintenance, allowlist: d.allowlist ?? next }, false);
      else mutate();
    } catch { mutate(); }
    finally { setSaving(false); }
  };

  if (!on) return null;

  const addEmail = () => {
    const e = pick.toLowerCase().trim();
    if (!e || allowlist.includes(e)) { setPick(''); return; }
    setPick('');
    persistAllowlist([...allowlist, e]);
  };
  const removeEmail = (e: string) => persistAllowlist(allowlist.filter(x => x !== e));

  return (
    <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
      <p className="text-xs font-semibold text-slate-300 mb-2" dir="rtl">
        מורשים בזמן תחזוקה {allowlist.length > 0 && `(${allowlist.length})`}
      </p>
      <div className="flex flex-col gap-1.5 mb-2">
        {allowlist.length === 0 && <span className="text-xs text-amber-400" dir="rtl">⚠️ אף אחד לא מורשה — הפעלת תחזוקה תנעל את כולם. הוסיפו משתמשים למטה.</span>}
        {allowlist.map(e => {
          const u = athletes.find(a => a.email.toLowerCase() === e);
          return (
            <div key={e} className="flex items-center gap-2 bg-slate-700/40 rounded-lg px-2.5 py-1.5 min-w-0">
              <span className="text-sm text-slate-200 flex-1 min-w-0 truncate">{u ? u.name : e}{u && <span className="text-slate-500 text-xs"> · {e}</span>}</span>
              <button onClick={() => removeEmail(e)} className="text-slate-400 hover:text-red-400 shrink-0" aria-label={`Remove ${e}`}><X className="w-4 h-4" /></button>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 min-w-0">
        <select
          value={pick} onChange={e => setPick(e.target.value)}
          className="flex-1 min-w-0 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-600">
          <option value="">בחרו משתמש…</option>
          {athletes.filter(a => !allowlist.includes(a.email.toLowerCase())).map(a => (
            <option key={a.email} value={a.email}>{a.name} ({a.email})</option>
          ))}
        </select>
        <button onClick={addEmail} disabled={saving || !pick}
          className="inline-flex items-center gap-1 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold px-3 rounded-lg">
          <Plus className="w-4 h-4" /> הוספה
        </button>
      </div>
    </div>
  );
}
