'use client';

import { useState, useEffect, useRef } from 'react';
import { ShoppingBag, Loader2, Plus, ImagePlus, X, Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Sheet, SegmentedControl, Button, LoadingBlock, EmptyState, Switch } from '@/components/ui';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { authedFetch } from '@/lib/auth/authed-fetch';

interface Product {
  id: string;
  nameHe: string;
  nameEn: string;
  descriptionHe: string | null;
  descriptionEn: string | null;
  price: number;
  imageUrl: string | null;
  sizes: string[] | null;
  colors: string[] | null;
  stock: number | null;
  active: boolean;
}
interface OrderItem { nameHe: string; size: string | null; color: string | null; quantity: number; unitPrice: number }
interface Order {
  id: string; athleteName: string | null; athleteAvatarUrl: string | null; status: string;
  total: number; contactPhone: string | null; notes: string | null; createdAt: string; items: OrderItem[];
}

const STATUSES = ['pending_payment', 'paid', 'fulfilled', 'cancelled'] as const;

/**
 * Settings > Management > Store Manager (roadmap #9). Product catalog CRUD
 * + order management, mirroring Badge/Challenge Manager's pattern. No
 * payment processor is connected yet — orders land as 'pending_payment' and
 * staff advances status manually once payment is arranged out-of-band.
 */
export function StoreManager() {
  const t = useTranslations('storeManager');
  const [tab, setTab] = useState<'products' | 'orders'>('products');

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [nameHe, setNameHe] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [descriptionHe, setDescriptionHe] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [price, setPrice] = useState('');
  const [sizesInput, setSizesInput] = useState('');
  const [colorsInput, setColorsInput] = useState('');
  const [stock, setStock] = useState('');
  const [activeState, setActiveState] = useState(true);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null);

  const fetchProducts = () => {
    setProductsLoading(true);
    authedFetch('/api/admin/store/products')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setProducts(d?.products || []))
      .catch(() => {})
      .finally(() => setProductsLoading(false));
  };
  const fetchOrders = () => {
    setOrdersLoading(true);
    authedFetch('/api/admin/store/orders')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOrders(d?.orders || []))
      .catch(() => {})
      .finally(() => setOrdersLoading(false));
  };

  useEffect(() => { fetchProducts(); fetchOrders(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setNameHe(''); setNameEn(''); setDescriptionHe(''); setDescriptionEn('');
    setPrice(''); setSizesInput(''); setColorsInput(''); setStock(''); setActiveState(true);
    setImageFile(null); setImagePreview(null); setError(null);
  };
  const openNew = () => { resetForm(); setSheetOpen(true); };
  const openEdit = (product: Product) => {
    setEditingId(product.id);
    setNameHe(product.nameHe);
    setNameEn(product.nameEn);
    setDescriptionHe(product.descriptionHe || '');
    setDescriptionEn(product.descriptionEn || '');
    setPrice(String(product.price));
    setSizesInput((product.sizes || []).join(', '));
    setColorsInput((product.colors || []).join(', '));
    setStock(product.stock != null ? String(product.stock) : '');
    setActiveState(product.active);
    setImageFile(null);
    setImagePreview(product.imageUrl || null);
    setError(null);
    setSheetOpen(true);
  };
  const handleImagePick = (file: File | null) => {
    setImageFile(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const canSave = nameHe.trim().length > 0 && nameEn.trim().length > 0 && Number(price) >= 0 && price !== '' && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      let imageUrl: string | undefined;
      if (imageFile) {
        const form = new FormData();
        form.append('file', imageFile);
        const uploadRes = await authedFetch('/api/admin/store/products/image', { method: 'POST', body: form });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) throw new Error(uploadData.error || t('uploadError'));
        imageUrl = uploadData.url;
      } else if (editingId && imagePreview === null) {
        // Existing image explicitly removed (X clicked) while editing.
        imageUrl = '';
      }

      const sizes = sizesInput.split(',').map((s) => s.trim()).filter(Boolean);
      const colors = colorsInput.split(',').map((c) => c.trim()).filter(Boolean);
      const payload = {
        nameHe: nameHe.trim(),
        nameEn: nameEn.trim(),
        descriptionHe: descriptionHe.trim() || undefined,
        descriptionEn: descriptionEn.trim() || undefined,
        price: Number(price),
        sizes: sizes.length > 0 ? sizes : undefined,
        colors: colors.length > 0 ? colors : undefined,
        stock: stock.trim() ? Number(stock) : undefined,
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(editingId ? { active: activeState } : {}),
      };
      const res = await authedFetch(
        editingId ? `/api/admin/store/products/${editingId}` : '/api/admin/store/products',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || (editingId ? t('updateError') : t('createError')));

      setSheetOpen(false);
      resetForm();
      fetchProducts();
    } catch (err: unknown) {
      setError((err as Error).message || (editingId ? t('updateError') : t('createError')));
    } finally {
      setSaving(false);
    }
  };

  const updateOrderStatus = async (order: Order, status: string) => {
    setUpdatingOrder(order.id);
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status } : o)));
    try {
      await authedFetch(`/api/admin/store/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: order.status } : o)));
    } finally {
      setUpdatingOrder(null);
    }
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div>
      <SegmentedControl<'products' | 'orders'>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'products', label: t('productsTab') },
          { value: 'orders', label: t('ordersTab') },
        ]}
        className="mb-4"
      />

      {tab === 'products' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">{t('existingProducts')}</h2>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4" />
              {t('newProduct')}
            </Button>
          </div>

          {productsLoading ? (
            <LoadingBlock />
          ) : products.length === 0 ? (
            <EmptyState icon={ShoppingBag} title={t('noProducts')} />
          ) : (
            <InsetSection>
              {products.map((p) => (
                <InsetRow
                  key={p.id}
                  label={p.nameHe}
                  sublabel={`${p.nameEn} · ${p.price} ₪`}
                  onClick={() => openEdit(p)}
                  trailing={
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className={cn('text-2xs font-bold px-2 py-0.5 rounded-full', p.active ? 'bg-green-500/15 text-green-400' : 'bg-slate-700 text-slate-500')}>
                        {p.active ? t('active') : t('inactive')}
                      </span>
                      <div className="w-9 h-9 rounded-lg bg-slate-900/60 border border-slate-700/50 flex items-center justify-center overflow-hidden">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                    </div>
                  }
                />
              ))}
            </InsetSection>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div>
          <h2 className="text-sm font-semibold text-white mb-4">{t('allOrders')}</h2>
          {ordersLoading ? (
            <LoadingBlock />
          ) : orders.length === 0 ? (
            <EmptyState icon={Package} title={t('noOrders')} />
          ) : (
            <div className="space-y-2.5">
              {orders.map((o) => (
                <div key={o.id} className="rounded-2xl bg-slate-800/50 border border-slate-700/40 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-white" dir="auto">{o.athleteName || '—'}</span>
                    <span className="text-xs text-slate-500">{fmtDate(o.createdAt)}</span>
                  </div>
                  <div className="space-y-0.5 mb-1.5">
                    {o.items.map((it, i) => {
                      const variant = [it.size, it.color].filter(Boolean).join(' · ');
                      return (
                        <p key={i} className="text-xs text-slate-400" dir="auto">
                          {it.quantity}× {it.nameHe}{variant ? ` (${variant})` : ''}
                        </p>
                      );
                    })}
                  </div>
                  {o.contactPhone && <p className="text-xs text-slate-400 mb-1">📞 {o.contactPhone}</p>}
                  {o.notes && <p className="text-xs text-slate-500 mb-1.5" dir="auto">{o.notes}</p>}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-bold text-primary-400">{o.total} ₪</span>
                    <select
                      value={o.status}
                      disabled={updatingOrder === o.id}
                      onChange={(e) => updateOrderStatus(o, e.target.value)}
                      className="bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-primary-500"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{t(`status_${s}` as any)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) resetForm(); }} title={editingId ? t('editProduct') : t('newProduct')}>
        <div className="space-y-4 pb-2">
          {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('nameHebrew')}</label>
              <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} dir="rtl" className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white focus:outline-none focus:border-primary-600/50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('nameEnglish')}</label>
              <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white focus:outline-none focus:border-primary-600/50" />
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
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('price')} (₪)</label>
              <input type="number" min={0} step="any" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="120" className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('stockOptional')}</label>
              <input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} placeholder={t('unlimited')} className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('sizesOptional')}</label>
              <input value={sizesInput} onChange={(e) => setSizesInput(e.target.value)} placeholder="S, M, L, XL" dir="ltr" className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50" />
              <p className="text-2xs text-slate-500 mt-1">{t('sizesHint')}</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('colorsOptional')}</label>
              <input value={colorsInput} onChange={(e) => setColorsInput(e.target.value)} placeholder="Black, White, Red" dir="ltr" className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50" />
              <p className="text-2xs text-slate-500 mt-1">{t('colorsHint')}</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('productImage')}</label>
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

          {editingId && (
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50">
              <span className="text-sm font-medium text-white">{activeState ? t('active') : t('inactive')}</span>
              <Switch checked={activeState} onChange={(v) => setActiveState(v)} size="sm" />
            </div>
          )}

          <Button className="w-full" onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
            {saving ? (editingId ? t('updating') : t('creating')) : (editingId ? t('saveChanges') : t('createProduct'))}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
