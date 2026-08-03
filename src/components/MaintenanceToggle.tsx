'use client';

import { useState, useEffect } from 'react';
import { Construction, Loader2, X, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Admin control: turn the "under renovation" gate on/off AND manage the saved
// allowlist of emails that may use the app during maintenance. Approver accounts
// are always allowed (can't be locked out). Approver-gated server-side.
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
    <div className={cn('mb-6 rounded-xl border p-4', on ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-800/50 border-slate-700/50')}>
      <div className="flex items-center gap-3">
        <Construction className={cn('w-5 h-5 shrink-0', on ? 'text-amber-400' : 'text-slate-400')} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white flex items-center gap-2">
            Maintenance mode {on ? '· ON' : '· off'}
            {savedFlash && <Check className="w-3.5 h-3.5 text-green-400" />}
          </p>
          <p className="text-xs text-slate-400">{on ? 'Only approvers + the allowlist below can use the app — everyone else sees the under-renovation screen.' : 'The app is live for everyone.'}</p>
        </div>
        <button onClick={toggle} disabled={saving || on == null}
          className={cn('relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50', on ? 'bg-amber-500' : 'bg-slate-600')}
          aria-label="Toggle maintenance mode">
          {saving
            ? <Loader2 className="w-4 h-4 animate-spin text-white absolute inset-0 m-auto" />
            : <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white transition-all', on ? 'start-6' : 'start-1')} />}
        </button>
      </div>

      {/* Allowlist — who can use the app while under renovation */}
      <div className="mt-3 pt-3 border-t border-slate-700/50">
        <p className="text-xs font-semibold text-slate-400 mb-2">Allowed during maintenance (saved)</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {allowlist.length === 0 && <span className="text-xs text-slate-500">Only approvers (admins) — add emails to let others in.</span>}
          {allowlist.map(e => (
            <span key={e} className="inline-flex items-center gap-1 bg-slate-700/50 rounded-full ps-2.5 pe-1 py-1 text-xs text-slate-200">
              {e}
              <button onClick={() => removeEmail(e)} className="text-slate-400 hover:text-red-400" aria-label={`Remove ${e}`}><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <select
            value={pick} onChange={e => setPick(e.target.value)}
            className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#4338ff]">
            <option value="">Select a user…</option>
            {athletes.filter(a => !allowlist.includes(a.email.toLowerCase())).map(a => (
              <option key={a.email} value={a.email}>{a.name} ({a.email})</option>
            ))}
          </select>
          <button onClick={addEmail} disabled={saving || !pick}
            className="inline-flex items-center gap-1 bg-[#4338ff] hover:bg-[#3730d4] disabled:opacity-50 text-white text-sm font-semibold px-3 rounded-lg">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
