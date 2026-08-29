'use client';

import { useState, useEffect } from 'react';
import { Construction, X, Plus } from 'lucide-react';
import { useApi, authHeaders } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { InsetRow } from '@/components/ui/InsetList';
import { Sheet, Switch } from '@/components/ui';

// Admin control: the "under renovation" gate on/off + the allowlist of emails
// allowed during maintenance. Split into a compact inset ROW (so it can share a
// grouped card with other settings rows, like the reference design) and a
// separate ALLOWLIST card shown only when maintenance is on. Both read the same
// SWR-cached /api/maintenance, so state stays in sync from one fetch.
interface MaintenanceData { maintenance: boolean; allowlist: string[] }

// One inset row: colored construction glyph + label + inline toggle. Uses the
// real InsetRow primitive (icon tile + label/sublabel + trailing slot) instead
// of hand-copying its classes, so this row stays in sync with the shared
// component automatically.
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
        method: 'PUT', headers: await bearerHeaders(),
        body: JSON.stringify({ on: !on }),
      });
      const d = await res.json();
      if (res.ok) mutate({ maintenance: !!d.maintenance, allowlist: d.allowlist ?? data?.allowlist ?? [] }, false);
      else mutate(); // revalidate → roll back
    } catch { mutate(); }
    finally { setSaving(false); }
  };

  return (
    <InsetRow
      icon={Construction}
      iconBg={on ? 'bg-amber-500' : 'bg-slate-600'}
      label="מצב תחזוקה"
      sublabel={on ? 'רק מורשים רואים את האפליקציה' : 'האפליקציה פתוחה לכולם'}
      trailing={<Switch checked={!!on} onChange={toggle} disabled={saving || on == null} loading={saving} activeColor="bg-green-500" ariaLabel="Toggle maintenance mode" />}
    />
  );
}

// The allowlist editor — its own card, shown only while maintenance is on.
export function MaintenanceAllowlist() {
  const { data, mutate } = useApi<MaintenanceData>('/api/maintenance');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [athletes, setAthletes] = useState<Array<{ name: string; email: string }>>([]);
  const on = data?.maintenance ?? false;
  const allowlist = data?.allowlist ?? [];

  useEffect(() => {
    fetch('/api/admin/users', { headers: authHeaders() }).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.users) setAthletes(d.users.filter((u: any) => u.email).map((u: any) => ({ name: u.name || u.email, email: u.email })));
    }).catch(() => {});
  }, []);

  const persistAllowlist = async (next: string[]) => {
    setSaving(true);
    mutate({ maintenance: on, allowlist: next }, false); // optimistic
    try {
      const res = await fetch('/api/maintenance', {
        method: 'PUT', headers: await bearerHeaders(),
        body: JSON.stringify({ allowlist: next }),
      });
      const d = await res.json();
      if (res.ok) mutate({ maintenance: !!d.maintenance, allowlist: d.allowlist ?? next }, false);
      else mutate();
    } catch { mutate(); }
    finally { setSaving(false); }
  };

  if (!on) return null;

  const addEmail = (email: string) => {
    const e = email.toLowerCase().trim();
    if (!e || allowlist.includes(e)) { setPickerOpen(false); return; }
    setPickerOpen(false);
    persistAllowlist([...allowlist, e]);
  };
  const removeEmail = (e: string) => persistAllowlist(allowlist.filter(x => x !== e));

  // Athletes not already on the allowlist — the pool the picker sheet offers.
  const available = athletes.filter(a => !allowlist.includes(a.email.toLowerCase()));

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
              {/* Padded hit-area (p-2.5 -m-2.5): visually unchanged 16px icon,
                  but the tappable region grows to the 44px minimum. */}
              <button onClick={() => removeEmail(e)} className="p-2.5 -m-2.5 text-slate-400 hover:text-red-400 shrink-0" aria-label={`Remove ${e}`}><X className="w-4 h-4" /></button>
            </div>
          );
        })}
      </div>

      {/* Bottom-sheet athlete picker — replaces the raw <select> (native
          browser dropdown chrome) with tappable InsetRows. */}
      <button
        onClick={() => setPickerOpen(true)}
        disabled={saving || available.length === 0}
        className="inline-flex items-center gap-1 min-h-[44px] bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold px-3 rounded-lg"
      >
        <Plus className="w-4 h-4" /> הוספה
      </button>

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen} title="בחרו משתמש">
        <div className="rounded-2xl bg-slate-900/40 overflow-hidden divide-y divide-slate-700/50">
          {available.map(a => (
            <InsetRow key={a.email} label={a.name} sublabel={a.email} onClick={() => addEmail(a.email)} />
          ))}
          {available.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500" dir="rtl">אין משתמשים נוספים</p>
          )}
        </div>
      </Sheet>
    </div>
  );
}
