'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShoppingBag, ShoppingCart, X, Plus, Minus, Trash2, CheckCircle2, Package } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useApi } from '@/lib/api';
import { Card, Button, EmptyState, SkeletonCard, SegmentedControl, Sheet } from '@/components/ui';

interface Product {
  id: string;
  nameHe: string;
  nameEn: string;
  descriptionHe: string | null;
  descriptionEn: string | null;
  price: number;
  imageUrl: string | null;
  sizes: string[] | null;
  stock: number | null;
}
interface CartLine { productId: string; size: string | null; quantity: number }
interface OrderItem { nameHe: string; nameEn: string; size: string | null; quantity: number; unitPrice: number }
interface Order { id: string; status: string; total: number; createdAt: string; items: OrderItem[] }

const CART_KEY = 'madregot_store_cart';
const STATUS_LABEL_KEY: Record<string, string> = {
  pending_payment: 'statusPendingPayment',
  paid: 'statusPaid',
  fulfilled: 'statusFulfilled',
  cancelled: 'statusCancelled',
};

export default function StorePage() {
  const t = useTranslations('store');
  const locale = useLocale();
  const [tab, setTab] = useState<'shop' | 'orders'>('shop');
  const [athleteId, setAthleteId] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);

  useEffect(() => {
    setAthleteId(localStorage.getItem('athlete_id') || '');
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw));
    } catch { /* ignore corrupt cart */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  const { data: productsData, isLoading: productsLoading } = useApi<{ products: Product[] }>('/api/store/products');
  const { data: ordersData, isLoading: ordersLoading, mutate: mutateOrders } = useApi<{ orders: Order[] }>(
    tab === 'orders' && athleteId ? `/api/store/orders?athleteId=${encodeURIComponent(athleteId)}` : null,
  );

  const products = productsData?.products || [];
  const productById = useMemo(() => new Map((productsData?.products || []).map((p) => [p.id, p])), [productsData]);
  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const cartTotal = cart.reduce((sum, l) => sum + (productById.get(l.productId)?.price || 0) * l.quantity, 0);

  const name = (p: Product) => (locale === 'he' ? p.nameHe : p.nameEn);
  const description = (p: Product) => (locale === 'he' ? p.descriptionHe : p.descriptionEn);

  const openProduct = (p: Product) => {
    setProduct(p);
    setSize(p.sizes?.[0] || null);
  };

  const addToCart = () => {
    if (!product) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id && l.size === size);
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { productId: product.id, size, quantity: 1 }];
    });
    setProduct(null);
  };

  const updateQty = (line: CartLine, delta: number) => {
    setCart((prev) => {
      const next = prev.map((l) =>
        l === line ? { ...l, quantity: l.quantity + delta } : l,
      ).filter((l) => l.quantity > 0);
      return next;
    });
  };

  const removeLine = (line: CartLine) => setCart((prev) => prev.filter((l) => l !== line));

  const placeOrder = async () => {
    if (!athleteId || cart.length === 0 || placing) return;
    setPlacing(true);
    setPlaceError('');
    try {
      const res = await fetch('/api/store/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athleteId,
          items: cart.map((l) => ({ productId: l.productId, size: l.size, quantity: l.quantity })),
          contactPhone: phone,
          notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t('checkoutError'));
      setPlacedOrderId(data.orderId);
      setCart([]);
      mutateOrders();
    } catch (err: unknown) {
      setPlaceError((err as Error).message || t('checkoutError'));
    } finally {
      setPlacing(false);
    }
  };

  const closeAfterOrder = () => {
    setPlacedOrderId(null);
    setCheckoutOpen(false);
    setCartOpen(false);
    setPhone('');
    setNotes('');
    setTab('orders');
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-white tracking-tight" dir="rtl">{t('title')}</h1>
        {tab === 'shop' && (
          <button
            onClick={() => setCartOpen(true)}
            className="relative p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 text-white"
            aria-label={t('cart')}
          >
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 && (
              <span className="absolute -top-1.5 -end-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-600 text-white text-3xs font-bold flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        )}
      </div>

      <SegmentedControl<'shop' | 'orders'>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'shop', label: t('shopTab') },
          { value: 'orders', label: t('ordersTab') },
        ]}
      />

      <p className="text-2xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
        {t('paymentComingSoonNotice')}
      </p>

      {tab === 'shop' && (
        productsLoading && !productsData ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} className="h-44" />)}
          </div>
        ) : products.length === 0 ? (
          <EmptyState icon={ShoppingBag} title={t('noProducts')} className="py-10" />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {products.map((p) => (
              <button key={p.id} onClick={() => openProduct(p)} className="text-start">
                <Card variant="solid" className="!p-0 overflow-hidden h-full flex flex-col">
                  <div className="aspect-square bg-slate-900/60 flex items-center justify-center">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={name(p)} className="w-full h-full object-cover" />
                    ) : (
                      <Package className="h-8 w-8 text-slate-600" />
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-sm font-semibold text-white truncate" dir="auto">{name(p)}</p>
                    <p className="text-sm font-bold text-primary-400 mt-0.5">{p.price} {t('currency')}</p>
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )
      )}

      {tab === 'orders' && (
        ordersLoading && !ordersData ? (
          <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} className="h-20" />)}</div>
        ) : (ordersData?.orders.length || 0) === 0 ? (
          <EmptyState icon={Package} title={t('noOrders')} className="py-10" />
        ) : (
          <div className="space-y-2.5">
            {ordersData!.orders.map((o) => (
              <Card key={o.id} variant="solid">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">{fmtDate(o.createdAt)}</p>
                  <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-primary-600/20 text-primary-300">
                    {t(STATUS_LABEL_KEY[o.status] as any)}
                  </span>
                </div>
                <div className="mt-1.5 space-y-0.5">
                  {o.items.map((it, i) => (
                    <p key={i} className="text-sm text-slate-300" dir="auto">
                      {it.quantity}× {locale === 'he' ? it.nameHe : it.nameEn}{it.size ? ` (${it.size})` : ''}
                    </p>
                  ))}
                </div>
                <p className="text-sm font-bold text-white mt-1.5">{o.total} {t('currency')}</p>
              </Card>
            ))}
          </div>
        )
      )}

      {/* Product detail sheet */}
      <Sheet open={!!product} onOpenChange={(o) => !o && setProduct(null)} title={product ? name(product) : ''}>
        {product && (
          <div className="space-y-3 pb-2">
            <div className="aspect-square rounded-xl bg-slate-900/60 flex items-center justify-center overflow-hidden">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt={name(product)} className="w-full h-full object-cover" />
              ) : (
                <Package className="h-10 w-10 text-slate-600" />
              )}
            </div>
            {description(product) && <p className="text-sm text-slate-300" dir="auto">{description(product)}</p>}
            <p className="text-lg font-bold text-primary-400">{product.price} {t('currency')}</p>
            {product.sizes && product.sizes.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('size')}</label>
                <SegmentedControl<string>
                  value={size || product.sizes[0]}
                  onChange={setSize}
                  options={product.sizes.map((s) => ({ value: s, label: s }))}
                />
              </div>
            )}
            <Button className="w-full" onClick={addToCart}>{t('addToCart')}</Button>
          </div>
        )}
      </Sheet>

      {/* Cart sheet */}
      <Sheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        title={t('cart')}
        trailingAction={
          <button onClick={() => setCartOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-white" aria-label={t('close')}>
            <X className="h-5 w-5" />
          </button>
        }
        footer={
          cart.length > 0 ? (
            <div className="px-5 pt-2 pb-4 border-t border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">{t('total')}</span>
                <span className="font-bold text-white">{cartTotal} {t('currency')}</span>
              </div>
              <Button className="w-full" onClick={() => setCheckoutOpen(true)}>{t('checkout')}</Button>
            </div>
          ) : undefined
        }
      >
        {cart.length === 0 ? (
          <EmptyState icon={ShoppingCart} title={t('cartEmpty')} className="py-8" />
        ) : (
          <div className="space-y-2 pb-2">
            {cart.map((line, i) => {
              const p = productById.get(line.productId);
              if (!p) return null;
              return (
                <div key={i} className="flex items-center gap-3 bg-slate-800/50 rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate" dir="auto">{name(p)}{line.size ? ` (${line.size})` : ''}</p>
                    <p className="text-xs text-slate-500">{p.price} {t('currency')}</p>
                  </div>
                  <button onClick={() => updateQty(line, -1)} className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-white"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-5 text-center text-sm font-bold text-white tabular-nums">{line.quantity}</span>
                  <button onClick={() => updateQty(line, 1)} className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-white"><Plus className="h-3.5 w-3.5" /></button>
                  <button onClick={() => removeLine(line)} className="text-red-400"><Trash2 className="h-4 w-4" /></button>
                </div>
              );
            })}
          </div>
        )}
      </Sheet>

      {/* Checkout sheet */}
      <Sheet open={checkoutOpen} onOpenChange={setCheckoutOpen} title={t('checkout')}>
        {placedOrderId ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
            <p className="text-sm font-bold text-white">{t('orderPlaced')}</p>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">{t('paymentComingSoonNotice')}</p>
            <Button onClick={closeAfterOrder}>{t('viewMyOrders')}</Button>
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            <p className="text-2xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
              {t('paymentComingSoonNotice')}
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('contactPhone')}</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white text-end focus:outline-none focus:border-primary-600/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('notesOptional')}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                dir="rtl"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white resize-none focus:outline-none focus:border-primary-600/50"
              />
            </div>
            <div className="flex items-center justify-between text-sm px-1">
              <span className="text-slate-400">{t('total')}</span>
              <span className="font-bold text-white">{cartTotal} {t('currency')}</span>
            </div>
            {placeError && <p className="text-xs text-red-400">{placeError}</p>}
            <Button className="w-full" onClick={placeOrder} disabled={placing}>
              {placing ? t('placingOrder') : t('placeOrder')}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
