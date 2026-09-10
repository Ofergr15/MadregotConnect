'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, ChevronDown, Footprints, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Sheet, Switch, ConfirmSheet } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import {
  SHOE_CATALOG,
  catalogShoeName,
  findCatalogShoe,
  type ShoeCatalogEntry,
} from '@/lib/shoe-catalog';

interface Shoe {
  id: string;
  name: string;
  distanceLimitKm: number | null;
  alertBeforeKm: number;
  retired: boolean;
  isActive: boolean;
  kmUsed: number;
}

/**
 * Per-athlete shoe tracker — lives on the Profile page. Each shoe accumulates
 * km automatically from the athlete's own activities (attributed at sync/log
 * time from whichever shoe is "active" then — see /api/shoes), so switching
 * shoes is a single toggle, not per-run bookkeeping. Crosses its own
 * distance limit → a push, handled server-side (src/lib/shoes.ts).
 */
export function ShoeManager({ athleteId }: { athleteId: string }) {
  const [shoes, setShoes] = useState<Shoe[]>([]);
  const [loading, setLoading] = useState(true);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [alertBefore, setAlertBefore] = useState('50');
  const [active, setActive] = useState(false);
  const [retired, setRetired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  // The km limit this component filled in itself, so picking a second model can
  // replace it — but a number the athlete typed is never overwritten.
  const [limitFromCatalog, setLimitFromCatalog] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!athleteId) { setLoading(false); return; }
    apiHeaders()
      .then(headers => fetch(`/api/shoes?athleteId=${encodeURIComponent(athleteId)}`, { headers }))
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data) setShoes(data.shoes || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [athleteId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setAdding(true);
    setEditingId(null);
    setName('');
    setLimit('');
    setAlertBefore('50');
    setActive(shoes.length === 0);
    setRetired(false);
    setError(null);
    // Open on the model list: picking a pair is the common case, and typing a
    // name is the exception it falls back to.
    setShowCatalog(true);
    setLimitFromCatalog(null);
    setSheetOpen(true);
  };

  const openEdit = (s: Shoe) => {
    setAdding(false);
    setEditingId(s.id);
    setName(s.name);
    setLimit(s.distanceLimitKm != null ? String(s.distanceLimitKm) : '');
    setAlertBefore(String(s.alertBeforeKm));
    setActive(s.isActive);
    setRetired(s.retired);
    setError(null);
    // Collapsed when editing — the shoe already has a name, and the reason to be
    // on this screen is usually the km limit or the retired switch.
    setShowCatalog(false);
    setLimitFromCatalog(null);
    setSheetOpen(true);
  };

  // Prefills the name, and the limit only when there is nothing of the athlete's
  // own to lose. See lib/shoe-catalog.ts on why the number is a suggestion.
  const pickModel = (entry: ShoeCatalogEntry) => {
    setName(catalogShoeName(entry));
    const suggested = String(entry.suggestedLimitKm);
    if (limit.trim() === '' || limit === limitFromCatalog) {
      setLimit(suggested);
      setLimitFromCatalog(suggested);
    }
    setShowCatalog(false);
    setError(null);
  };

  const selectedModel = findCatalogShoe(name);

  const save = async () => {
    if (!name.trim()) { setError('שם הנעליים נדרש'); return; }
    setSaving(true);
    setError(null);
    try {
      if (adding) {
        const res = await fetch('/api/shoes', {
          method: 'POST',
          headers: await apiHeaders(true),
          body: JSON.stringify({
            athleteId, name,
            distanceLimitKm: limit ? Number(limit) : null,
            // An explicit "0" (only alert exactly at the limit, no early
            // warning) is a legitimate choice — `Number(alertBefore) || 50`
            // would silently coerce it back to 50 on every save.
            alertBeforeKm: alertBefore.trim() === '' ? 50 : Number(alertBefore),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'שגיאה בשמירה');
        if (active && shoes.length > 0) {
          await fetch('/api/shoes', {
            method: 'PATCH',
            headers: await apiHeaders(true),
            body: JSON.stringify({ id: data.shoe.id, athleteId, setActive: true }),
          });
        }
      } else if (editingId) {
        const res = await fetch('/api/shoes', {
          method: 'PATCH',
          headers: await apiHeaders(true),
          body: JSON.stringify({
            id: editingId, athleteId, name,
            distanceLimitKm: limit ? Number(limit) : null,
            // An explicit "0" (only alert exactly at the limit, no early
            // warning) is a legitimate choice — `Number(alertBefore) || 50`
            // would silently coerce it back to 50 on every save.
            alertBeforeKm: alertBefore.trim() === '' ? 50 : Number(alertBefore),
            retired,
            ...(active ? { setActive: true } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'שגיאה בשמירה');
      }
      setSheetOpen(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSheetOpen(false);
    try {
      await fetch(`/api/shoes?id=${encodeURIComponent(id)}&athleteId=${encodeURIComponent(athleteId)}`, {
        method: 'DELETE',
        headers: await apiHeaders(),
      });
    } finally {
      load();
    }
  };

  if (loading || !athleteId) return null;

  return (
    <>
      <InsetSection header="נעלי ריצה">
        {shoes.map(s => {
          const nearLimit = !!s.distanceLimitKm && s.kmUsed >= s.distanceLimitKm - s.alertBeforeKm;
          return (
            <InsetRow
              key={s.id}
              icon={Footprints}
              iconBg={s.retired ? 'bg-ink-300' : 'bg-brand-600'}
              label={s.name}
              sublabel={s.isActive && !s.retired ? 'פעיל כרגע' : s.retired ? 'בדימוס' : undefined}
              value={s.distanceLimitKm ? `${s.kmUsed} / ${s.distanceLimitKm} ק״מ` : `${s.kmUsed} ק״מ`}
              valueSuccess={!!s.distanceLimitKm && !nearLimit}
              valueMuted={!s.distanceLimitKm}
              onClick={() => openEdit(s)}
            />
          );
        })}
        <InsetRow icon={Plus} iconBg="bg-ink-300" label="הוספת נעליים" onClick={openAdd} />
      </InsetSection>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => { if (!open) setSheetOpen(false); }}
        title={adding ? 'נעליים חדשות' : 'עריכת נעליים'}
      >
        <div dir="rtl" className="space-y-4">
          {/* The model list and the text field are both always reachable: the
              club runs in HOKA, but a member in something else must still be
              able to log it — a picklist with no way out is exactly the bug
              reported on the shoe-SIZE field. */}
          <div>
            <button
              type="button"
              onClick={() => setShowCatalog(v => !v)}
              className="w-full flex items-center justify-between gap-2 bg-page/50 border border-page rounded-lg px-3 py-2.5 text-start"
            >
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-ink-400">דגם</span>
                <span className={cn('block text-base truncate', selectedModel ? 'text-ink-700' : 'text-ink-400')}>
                  {selectedModel ? catalogShoeName(selectedModel) : 'בחירה מתוך דגמי HOKA'}
                </span>
              </span>
              <ChevronDown
                className={cn('h-5 w-5 shrink-0 text-ink-400 transition-transform', showCatalog && 'rotate-180')}
              />
            </button>

            {showCatalog && (
              <div className="max-h-[46vh] overflow-y-auto mt-2 -mx-1 px-1">
                {SHOE_CATALOG.map(group => (
                  <InsetSection key={group.id} header={group.label}>
                    {group.models.map(entry => {
                      const isSelected = selectedModel?.model === entry.model;
                      return (
                        <InsetRow
                          key={entry.model}
                          label={entry.model}
                          sublabel={entry.purpose}
                          onClick={() => pickModel(entry)}
                          trailing={isSelected ? <Check className="h-5 w-5 text-brand-600" /> : undefined}
                        />
                      );
                    })}
                  </InsetSection>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-400 mb-1.5">שם</p>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="לדוגמה: Pegasus 41"
              maxLength={60}
              className="w-full bg-page/50 border border-page rounded-lg px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-ink-400 mb-1.5">מגבלת ק״מ (אופציונלי)</p>
              <input
                type="number"
                inputMode="numeric"
                value={limit}
                onChange={e => setLimit(e.target.value)}
                placeholder="600"
                className="w-full bg-page/50 border border-page rounded-lg px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-400 mb-1.5">התראה כמה ק״מ לפני</p>
              <input
                type="number"
                inputMode="numeric"
                value={alertBefore}
                onChange={e => setAlertBefore(e.target.value)}
                placeholder="50"
                className="w-full bg-page/50 border border-page rounded-lg px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-medium text-ink-700">נעליים פעילות כרגע</span>
            <Switch checked={active} onChange={setActive} ariaLabel="נעליים פעילות" />
          </div>
          {!adding && (
            <div className="flex items-center justify-between py-1">
              <span className="text-sm font-medium text-ink-700">בדימוס</span>
              <Switch checked={retired} onChange={setRetired} ariaLabel="בדימוס" />
            </div>
          )}

          {error && <p className="text-sm text-accent-red">{error}</p>}

          <button
            onClick={save}
            disabled={saving}
            className={cn(
              'w-full min-h-[48px] rounded-xl font-bold text-base transition-colors active:scale-[0.98]',
              !saving ? 'bg-brand-600 hover:bg-brand-700 text-white' : 'bg-page text-ink-400',
            )}
          >
            {saving ? '...' : 'שמירה'}
          </button>

          {!adding && editingId && (
            <button
              onClick={() => setConfirmDeleteId(editingId)}
              className="w-full flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl text-sm font-semibold text-accent-red hover:text-accent-red active:text-accent-red transition-colors"
            >
              <Trash2 className="h-4 w-4" /> מחיקת נעליים
            </button>
          )}
        </div>
      </Sheet>

      <ConfirmSheet
        open={!!confirmDeleteId}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
        title="למחוק את הנעליים?"
        description="הריצות עצמן לא יימחקו, רק החיבור לזוג הזה."
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        onConfirm={() => { if (confirmDeleteId) remove(confirmDeleteId); setConfirmDeleteId(null); }}
      />
    </>
  );
}
