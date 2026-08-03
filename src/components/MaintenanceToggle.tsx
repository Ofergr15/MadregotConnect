'use client';

import { useState, useEffect } from 'react';
import { Construction, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Admin control to turn the "under renovation" gate on/off. Approver-gated
// server-side; only rendered here for admins/coaches in Settings.
export function MaintenanceToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [actorEmail, setActorEmail] = useState('');

  useEffect(() => {
    setActorEmail(localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '');
    fetch('/api/maintenance')
      .then(r => r.ok ? r.json() : null)
      .then(d => setOn(!!d?.maintenance))
      .catch(() => setOn(false));
  }, []);

  const toggle = async () => {
    if (on == null) return;
    setSaving(true);
    const next = !on;
    try {
      const res = await fetch('/api/maintenance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next, actorEmail }),
      });
      if (res.ok) setOn(next);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <div className={cn('mb-6 rounded-xl border p-4 flex items-center gap-3',
      on ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-800/50 border-slate-700/50')}>
      <Construction className={cn('w-5 h-5 shrink-0', on ? 'text-amber-400' : 'text-slate-400')} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">Maintenance mode {on ? '· ON' : '· off'}</p>
        <p className="text-xs text-slate-400">{on ? 'Only admins/coaches can access the app — everyone else sees the under-renovation screen.' : 'The app is live for everyone.'}</p>
      </div>
      <button
        onClick={toggle}
        disabled={saving || on == null}
        className={cn('relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50',
          on ? 'bg-amber-500' : 'bg-slate-600')}
        aria-label="Toggle maintenance mode"
      >
        {saving
          ? <Loader2 className="w-4 h-4 animate-spin text-white absolute inset-0 m-auto" />
          : <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white transition-all', on ? 'start-6' : 'start-1')} />}
      </button>
    </div>
  );
}
