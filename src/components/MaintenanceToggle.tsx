'use client';

import { useState, useEffect } from 'react';
import { Construction, Loader2, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InsetSection } from '@/components/ui/InsetList';

// Admin control: turn the "under renovation" gate on/off AND manage the saved
// allowlist of emails that may use the app during maintenance. Approver accounts
// are always allowed (can't be locked out). Approver-gated server-side.
// Renders as an iOS-style inset row (toggle) + an allowlist card when ON.
export function MaintenanceToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [pick, setPick] = useState('');
  const [athletes, setAthletes] = useState<Array<{ name: string; email: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [actorEmail, setActorEmail] = useState('');

  useEffect(() => {
    setActorEmail(localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '');
    fetch('/api/maintenance')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setOn(!!d?.maintenance); setAllowlist(d?.allowlist || []); })
      .catch(() => setOn(false));
    // Load real users so the allowlist is a pick-list, not free text.
    fetch('/api/admin/users').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.users) setAthletes(d.users.filter((u: any) => u.email).map((u: any) => ({ name: u.name || u.email, email: u.email })));
    }).catch(() => {});
  }, []);

  const persist = async (patch: { on?: boolean; allowlist?: string[] }) => {
    setSaving(true);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, actorEmail }),
      });
      const d = await res.json();
      if (res.ok) {
        if (typeof d.maintenance === 'boolean') setOn(d.maintenance);
        if (Array.isArray(d.allowlist)) setAllowlist(d.allowlist);
        setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500);
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const toggle = () => { if (on != null) persist({ on: !on }); };
  const addEmail = () => {
    const e = pick.toLowerCase().trim();
    if (!e || allowlist.includes(e)) { setPick(''); return; }
    const next = [...allowlist, e];
    setAllowlist(next); setPick('');
    persist({ allowlist: next });
  };
  const removeEmail = (e: string) => {
    const next = allowlist.filter(x => x !== e);
    setAllowlist(next);
    persist({ allowlist: next });
  };

  return (
    <>
      {/* iOS-style inset row: colored glyph tile + label + inline toggle. */}
      <InsetSection>
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
      </InsetSection>

      {/* Allowlist card — only shown while maintenance is ON. */}
      {on && (
      <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="text-xs font-semibold text-slate-300 mb-2" dir="rtl">
          מורשים בזמן תחזוקה {allowlist.length > 0 && `(${allowlist.length})`}
        </p>
        <div className="flex flex-col gap-1.5 mb-2">
          {allowlist.length === 0 && <span className="text-xs text-amber-400">⚠️ No one is allowed — turning maintenance on would lock everyone out. Add users below.</span>}
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
            <option value="">Select a user…</option>
            {athletes.filter(a => !allowlist.includes(a.email.toLowerCase())).map(a => (
              <option key={a.email} value={a.email}>{a.name} ({a.email})</option>
            ))}
          </select>
          <button onClick={addEmail} disabled={saving || !pick}
            className="inline-flex items-center gap-1 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold px-3 rounded-lg">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>
      )}
    </>
  );
}
