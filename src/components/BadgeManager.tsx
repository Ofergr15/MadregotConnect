'use client';

import { useState, useEffect, useRef } from 'react';
import { Award, Loader2, Plus, ImagePlus, X, Trash2, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Sheet, SegmentedControl, Button, LoadingBlock, EmptyState, ConfirmSheet } from '@/components/ui';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { authedFetch } from '@/lib/auth/authed-fetch';

interface Badge {
  id: string;
  code: string;
  name_he: string;
  name_en: string;
  description_he: string | null;
  description_en: string | null;
  icon: string;
  icon_url: string | null;
  rule_type: string;
  rule_params: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

type MetricType = 'distance' | 'duration';

// A human-readable "100 km" / "50h" chip for the existing-badges list, for the
// two admin-creatable rule_types only — other rule_types (pr_bucket etc.,
// seed-only) render no chip.
function metricLabel(badge: Badge): string | null {
  if (badge.rule_type === 'cumulative_distance' && typeof badge.rule_params?.km === 'number') {
    return `${badge.rule_params.km} km`;
  }
  if (badge.rule_type === 'cumulative_duration' && typeof badge.rule_params?.hours === 'number') {
    return `${badge.rule_params.hours}h`;
  }
  return null;
}

/**
 * Settings > Management > Badge Manager detail screen (Phase 3 admin
 * extension — see roadmap's "missing parts" Achievements & Badges item).
 *
 * Shows the full badge catalog (read-only list) and a "+ New Badge" form,
 * scoped to the two metric types the product owner asked for: milestone
 * badges by cumulative distance (km) or cumulative time (hours). Awarding
 * badges is a separate award-evaluation engine (src/lib/badges/) — this
 * screen only manages the catalog row.
 */
export function BadgeManager() {
  const t = useTranslations('badgeManager');
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [nameHe, setNameHe] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [descriptionHe, setDescriptionHe] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [metricType, setMetricType] = useState<MetricType>('distance');
  const [thresholdValue, setThresholdValue] = useState('');
  const [activeState, setActiveState] = useState(true);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Badge | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchBadges = () => {
    setLoading(true);
    fetch('/api/badges')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setBadges(d?.badges || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchBadges(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setNameHe('');
    setNameEn('');
    setDescriptionHe('');
    setDescriptionEn('');
    setMetricType('distance');
    setThresholdValue('');
    setActiveState(true);
    setImageFile(null);
    setImagePreview(null);
    setError(null);
  };

  const openNew = () => {
    resetForm();
    setSheetOpen(true);
  };

  const openEdit = (badge: Badge) => {
    setEditingId(badge.id);
    setNameHe(badge.name_he);
    setNameEn(badge.name_en);
    setDescriptionHe(badge.description_he || '');
    setDescriptionEn(badge.description_en || '');
    setMetricType(badge.rule_type === 'cumulative_duration' ? 'duration' : 'distance');
    const threshold = badge.rule_type === 'cumulative_duration' ? badge.rule_params?.hours : badge.rule_params?.km;
    setThresholdValue(typeof threshold === 'number' ? String(threshold) : '');
    setActiveState(badge.active);
    setImageFile(null);
    setImagePreview(badge.icon_url || null);
    setError(null);
    setSheetOpen(true);
  };

  const handleImagePick = (file: File | null) => {
    setImageFile(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const canSave = nameHe.trim().length > 0 && nameEn.trim().length > 0 && Number(thresholdValue) > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      let iconUrl: string | undefined;
      if (imageFile) {
        const form = new FormData();
        form.append('file', imageFile);
        const uploadRes = await authedFetch('/api/admin/badges/icon', { method: 'POST', body: form });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) throw new Error(uploadData.error || t('uploadError'));
        iconUrl = uploadData.url;
      } else if (editingId && imagePreview === null) {
        iconUrl = '';
      }

      const payload = {
        nameHe: nameHe.trim(),
        nameEn: nameEn.trim(),
        descriptionHe: descriptionHe.trim() || undefined,
        descriptionEn: descriptionEn.trim() || undefined,
        metricType,
        thresholdValue: Number(thresholdValue),
        ...(iconUrl !== undefined ? { iconUrl } : {}),
        ...(editingId ? { active: activeState } : {}),
      };
      const res = await authedFetch(
        editingId ? `/api/admin/badges/${editingId}` : '/api/admin/badges',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (editingId ? t('updateError') : t('createError')));

      setSheetOpen(false);
      resetForm();
      fetchBadges();
    } catch (err: unknown) {
      setError((err as Error).message || (editingId ? t('updateError') : t('createError')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    // ConfirmSheet closes itself immediately on tap (before this resolves),
    // so any failure needs its own persistent banner on the list view rather
    // than relying on the (already-closed) sheet to show it.
    setDeleteTarget(null);
    setDeleteError(null);
    try {
      const res = await authedFetch(`/api/admin/badges/${target.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('deleteError'));
      fetchBadges();
    } catch (err: unknown) {
      setDeleteError((err as Error).message || t('deleteError'));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">{t('existingBadges')}</h2>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4" />
          {t('newBadge')}
        </Button>
      </div>

      {deleteError && (
        <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{deleteError}</div>
      )}

      {loading ? (
        <LoadingBlock />
      ) : badges.length === 0 ? (
        <EmptyState icon={Award} title={t('noBadges')} />
      ) : (
        <InsetSection>
          {badges.map(b => {
            const label = metricLabel(b);
            return (
              <InsetRow
                key={b.id}
                label={b.name_he}
                sublabel={label ? `${b.name_en} · ${label}` : b.name_en}
                trailing={
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn('text-2xs font-bold px-2 py-0.5 rounded-full', b.active ? 'bg-green-500/15 text-green-400' : 'bg-slate-700 text-slate-500')}>
                      {b.active ? t('active') : t('inactive')}
                    </span>
                    <button
                      onClick={() => openEdit(b)}
                      className="p-2 min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
                      aria-label={t('edit')}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(b)}
                      className="p-2 min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10"
                      aria-label={t('delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <div className="w-9 h-9 rounded-full bg-slate-900/60 border border-slate-700/50 flex items-center justify-center overflow-hidden">
                      {b.icon_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.icon_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-base">{b.icon}</span>
                      )}
                    </div>
                  </div>
                }
              />
            );
          })}
        </InsetSection>
      )}

      <Sheet open={sheetOpen} onOpenChange={o => { setSheetOpen(o); if (!o) resetForm(); }} title={editingId ? t('editBadge') : t('newBadge')}>
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('nameHebrew')}</label>
              <input
                value={nameHe}
                onChange={e => setNameHe(e.target.value)}
                dir="rtl"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('nameEnglish')}</label>
              <input
                value={nameEn}
                onChange={e => setNameEn(e.target.value)}
                dir="ltr"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('descriptionHebrew')}</label>
              <input
                value={descriptionHe}
                onChange={e => setDescriptionHe(e.target.value)}
                dir="rtl"
                placeholder={t('optional')}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('descriptionEnglish')}</label>
              <input
                value={descriptionEn}
                onChange={e => setDescriptionEn(e.target.value)}
                dir="ltr"
                placeholder={t('optional')}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('metricType')}</label>
            <SegmentedControl<MetricType>
              value={metricType}
              onChange={setMetricType}
              options={[
                { value: 'distance', label: t('byDistance') },
                { value: 'duration', label: t('byTime') },
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">
              {metricType === 'distance' ? t('thresholdKm') : t('thresholdHours')}
            </label>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={thresholdValue}
              onChange={e => setThresholdValue(e.target.value)}
              placeholder={metricType === 'distance' ? '100' : '50'}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('badgeImage')}</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={e => handleImagePick(e.target.files?.[0] || null)}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-primary-400 bg-primary-600/10 hover:bg-primary-600/20 transition-all"
              >
                <ImagePlus className="h-4 w-4" />
                {imagePreview ? t('changeImage') : t('uploadImage')}
              </button>
              {imagePreview && (
                <div className="relative w-14 h-14 shrink-0">
                  <div className="w-14 h-14 rounded-full overflow-hidden border border-slate-700/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                  </div>
                  {/* Always-visible remove badge — a CSS :hover reveal has no
                      persistent equivalent on iOS Safari, so this can't be
                      opacity-0/group-hover gated like a desktop hover card. */}
                  <button
                    type="button"
                    onClick={() => handleImagePick(null)}
                    aria-label={t('removeImage')}
                    className="absolute -top-1 -end-1 w-8 h-8 rounded-full bg-black/70 hover:bg-black/90 flex items-center justify-center text-white transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            <p className="text-2xs text-slate-500 mt-1.5">{t('badgeImageHint')}</p>
          </div>

          {editingId && (
            <label className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50">
              <span className="text-sm font-medium text-white">{activeState ? t('active') : t('inactive')}</span>
              <button
                type="button"
                onClick={() => setActiveState((v) => !v)}
                className={cn('relative w-11 h-6 rounded-full transition-colors', activeState ? 'bg-primary-600' : 'bg-slate-600')}
              >
                <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', activeState ? 'start-[22px]' : 'start-0.5')} />
              </button>
            </label>
          )}

          <Button className="w-full" onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />}
            {saving ? (editingId ? t('updating') : t('creating')) : (editingId ? t('saveChanges') : t('createBadge'))}
          </Button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('deleteBadge')}
        description={t('deleteBadgeDesc')}
        confirmLabel={t('delete')}
        onConfirm={handleDelete}
      />
    </div>
  );
}
