'use client';

import { useState } from 'react';
import { Gift, Copy, CheckCircle2, ExternalLink } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useApi } from '@/lib/api';
import { Card, Button, EmptyState, SkeletonCard, Sheet } from '@/components/ui';

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
}

export default function BenefitsPage() {
  const t = useTranslations('benefits');
  const locale = useLocale();
  const [perk, setPerk] = useState<Perk | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useApi<{ perks: Perk[] }>('/api/perks');
  const perks = data?.perks || [];

  const title = (p: Perk) => (locale === 'he' ? p.titleHe : p.titleEn);
  const description = (p: Perk) => (locale === 'he' ? p.descriptionHe : p.descriptionEn);

  const openPerk = (p: Perk) => { setPerk(p); setCopied(false); };
  const copyCode = () => {
    if (!perk?.discountCode) return;
    navigator.clipboard?.writeText(perk.discountCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-extrabold text-white tracking-tight" dir="rtl">{t('title')}</h1>
      <p className="text-sm text-slate-400" dir="rtl">{t('subtitle')}</p>

      {isLoading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} className="h-24" />)}
        </div>
      ) : perks.length === 0 ? (
        <EmptyState icon={Gift} title={t('noPerks')} className="py-10" />
      ) : (
        <div className="space-y-3">
          {perks.map((p) => (
            <button key={p.id} onClick={() => openPerk(p)} className="w-full text-start">
              <Card variant="solid" className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-slate-900/60 flex items-center justify-center overflow-hidden shrink-0">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={title(p)} className="w-full h-full object-cover" />
                  ) : (
                    <Gift className="h-5 w-5 text-slate-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate" dir="auto">{title(p)}</p>
                  <p className="text-xs text-slate-500 truncate" dir="auto">{p.sponsorName}</p>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <Sheet open={!!perk} onOpenChange={(o) => !o && setPerk(null)} title={perk ? title(perk) : ''}>
        {perk && (
          <div className="space-y-3 pb-2">
            <div className="aspect-[16/9] rounded-xl bg-slate-900/60 flex items-center justify-center overflow-hidden">
              {perk.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={perk.imageUrl} alt={title(perk)} className="w-full h-full object-cover" />
              ) : (
                <Gift className="h-10 w-10 text-slate-600" />
              )}
            </div>
            <p className="text-sm font-semibold text-primary-400" dir="auto">{perk.sponsorName}</p>
            {description(perk) && <p className="text-sm text-slate-300" dir="auto">{description(perk)}</p>}

            {perk.discountCode && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('discountCode')}</label>
                <button
                  onClick={copyCode}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm font-bold tabular-nums text-white"
                  dir="ltr"
                >
                  {perk.discountCode}
                  {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4 text-slate-400" />}
                </button>
              </div>
            )}

            {perk.redeemUrl && (
              <Button className="w-full" onClick={() => window.open(perk.redeemUrl!, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="h-4 w-4" /> {t('goToSponsor')}
              </Button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
