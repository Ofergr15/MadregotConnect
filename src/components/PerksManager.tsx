'use client';

import { useState, useEffect, useRef } from 'react';
import { Gift, Loader2, Plus, ImagePlus, X, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Sheet, Button, LoadingBlock, EmptyState, ConfirmSheet } from '@/components/ui';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { authedFetch } from '@/lib/auth/authed-fetch';

interface Perk {
  id: string;
  sponsorName: string;
  titleHe: string;
  titleEn: string;
  descriptionHe: string | null;
  descriptionEn: string | null;
  discountCode: string | null;
  redeemUrl: string | null;
  imageUrl: string | null;
  active: boolean;
}

/**
 * Settings > Management > Perks Manager (roadmap #5). Sponsor-perk CRUD,
 * mirroring Store Manager's pattern — no cart/checkout here, just a list a
 * member reads and redeems directly with the sponsor (a code, a link, or
 * free-text instructions).
 */
export function PerksManager() {
  const t = useTranslations('perksManager');
  const [perks, setPerks] = useState<Perk[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [sponsorName, setSponsorName] = useState('');
  const [titleHe, setTitleHe] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [descriptionHe, setDescriptionHe] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [discountCode, setDiscountCode] = useState('');
  const [redeemUrl, setRedeemUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const fetchPerks = () => {
    setLoading(true);
    authedFetch('/api/admin/perks')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPerks(d?.perks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPerks(); }, []);

  const resetForm = () => {
    setSponsorName(''); setTitleHe(''); setTitleEn(''); setDescriptionHe(''); setDescriptionEn('');
    setDiscountCode(''); setRedeemUrl('');
    setImageFile(null); setImagePreview(null); setError(null);
  };
  const openNew = () => { resetForm(); setSheetOpen(true); };
  const handleImagePick = (file: File | null) => {
    setImageFile(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const canSave = sponsorName.trim().length > 0 && titleHe.trim().length > 0 && titleEn.trim().length > 0 && !saving;

  const handleCreate = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      let imageUrl: string | undefined;
      if (imageFile) {
        const form = new FormData();
        form.append('file', imageFile);
        const uploadRes = await authedFetch('/api/admin/perks/image', { method: 'POST', body: form });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) throw new Error(uploadData.error || t('uploadError'));
        imageUrl = uploadData.url;
      }

      const res = await authedFetch('/api/admin/perks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sponsorName: sponsorName.trim(),
          titleHe: titleHe.trim(),
          titleEn: titleEn.trim(),
          descriptionHe: descriptionHe.trim() || undefined,
          descriptionEn: descriptionEn.trim() || undefined,
          discountCode: discountCode.trim() || undefined,
          redeemUrl: redeemUrl.trim() || undefined,
          imageUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('createError'));

      setSheetOpen(false);
      resetForm();
      fetchPerks();
    } catch (err: unknown) {
      setError((err as Error).message || t('createError'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (perk: Perk) => {
    setPerks((prev) => prev.map((p) => (p.id === perk.id ? { ...p, active: !p.active } : p)));
    try {
      await authedFetch(`/api/admin/perks/${perk.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !perk.active }),
      });
    } catch {
      setPerks((prev) => prev.map((p) => (p.id === perk.id ? { ...p, active: perk.active } : p)));
    }
  };

  const removePerk = async (id: string) => {
    setPerks((prev) => prev.filter((p) => p.id !== id));
    try { await authedFetch(`/api/admin/perks/${id}`, { method: 'DELETE' }); }
    catch { fetchPerks(); }
  };

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">{t('existingPerks')}</h2>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4" />
          {t('newPerk')}
        </Button>
      </div>

      {perks.length === 0 ? (
        <EmptyState icon={Gift} title={t('noPerks')} />
      ) : (
        <InsetSection>
          {perks.map((p) => (
            <InsetRow
              key={p.id}
              label={p.titleHe}
              sublabel={p.sponsorName}
              onClick={() => toggleActive(p)}
              trailing={
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className={cn('text-2xs font-bold px-2 py-0.5 rounded-full', p.active ? 'bg-green-500/15 text-green-400' : 'bg-slate-700 text-slate-500')}>
                    {p.active ? t('active') : t('inactive')}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.id); }}
                    className="p-2 min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10"
                    aria-label={t('delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              }
            />
          ))}
        </InsetSection>
      )}

      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) resetForm(); }} title={t('newPerk')}>
        <div className="space-y-4 pb-2">
          {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>}

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('sponsorName')}</label>
            <input value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white focus:outline-none focus:border-primary-600/50" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('titleHebrew')}</label>
              <input value={titleHe} onChange={(e) => setTitleHe(e.target.value)} dir="rtl" className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white focus:outline-none focus:border-primary-600/50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('titleEnglish')}</label>
              <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} dir="ltr" className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white focus:outline-none focus:border-primary-600/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('descriptionHebrew')}</label>
              <input value={descriptionHe} onChange={(e) => setDescriptionHe(e.target.value)} dir="rtl" placeholder={t('optional')} className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('descriptionEnglish')}</label>
              <input value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} dir="ltr" placeholder={t('optional')} className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('discountCodeOptional')}</label>
              <input value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} dir="ltr" placeholder="MADREGOT15" className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('redeemUrlOptional')}</label>
              <input value={redeemUrl} onChange={(e) => setRedeemUrl(e.target.value)} dir="ltr" placeholder="https://..." className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('perkImage')}</label>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleImagePick(e.target.files?.[0] || null)} />
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-primary-400 bg-primary-600/10 hover:bg-primary-600/20 transition-all">
                <ImagePlus className="h-4 w-4" />
                {imagePreview ? t('changeImage') : t('uploadImage')}
              </button>
              {imagePreview && (
                <div className="relative w-14 h-14 shrink-0">
                  <div className="w-14 h-14 rounded-lg overflow-hidden border border-slate-700/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                  </div>
                  <button type="button" onClick={() => handleImagePick(null)} aria-label={t('removeImage')} className="absolute -top-1 -end-1 w-8 h-8 rounded-full bg-black/70 hover:bg-black/90 flex items-center justify-center text-white transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <Button className="w-full" onClick={handleCreate} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            {saving ? t('creating') : t('createPerk')}
          </Button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('deletePerk')}
        description={t('deletePerkDesc')}
        confirmLabel={t('delete')}
        onConfirm={() => { if (deleteTarget) removePerk(deleteTarget); }}
      />
    </div>
  );
}
