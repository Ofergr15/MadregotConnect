'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Gift, Copy, CheckCircle2, ExternalLink } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useApi } from '@/lib/api';
import { Card, Button, EmptyState, SkeletonCard, Sheet } from '@/components/ui';
import CoreRunnerBadge from '@/components/CoreRunnerBadge';

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
  tier?: 'all' | 'core_runner';
}

export default function BenefitsPage() {
  return (
    <Suspense fallback={<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mt-20"></div>}>
      <BenefitsPageContent />
    </Suspense>
  );
}

function BenefitsPageContent() {
  const t = useTranslations('benefits');
  const locale = useLocale();
  const [perk, setPerk] = useState<Perk | null>(null);
  const [copied, setCopied] = useState(false);

  // No athleteId in the URL any more: the route reads the caller's tier off
  // the session, so sending an id decided nothing and waiting for localStorage
  // only delayed the first fetch by a render.
  const { data, isLoading } = useApi<{ perks: Perk[] }>('/api/perks');
  const perks = data?.perks || [];

  // הגרעין (migration 091). This is the screen that EXPLAINS the tier, which is
  // why the flag is read here rather than signposted from the profile: the
  // exclusive perks are already tagged below, and this banner is what turns those
  // tags from a restriction into an entitlement — "these are tagged because you
  // are in" instead of "some of these might not be for you".
  //
  // Staff and the super user see the core-tier perks too (see /api/perks), but
  // they are not IN the גרעין, so the banner is gated on the flag alone. Claiming
  // membership to an admin reviewing the catalogue would simply be wrong.
  const { data: me } = useApi<{ isCoreRunner?: boolean }>('/api/auth/me');
  const corePerks = perks.filter((p) => p.tier === 'core_runner');
  const showCoreBanner = me?.isCoreRunner === true && corePerks.length > 0;

  const title = (p: Perk) => (locale === 'he' ? p.titleHe : p.titleEn);
  const description = (p: Perk) => (locale === 'he' ? p.descriptionHe : p.descriptionEn);

  const openPerk = (p: Perk) => { setPerk(p); setCopied(false); };

  // Deep-link from search (`/dashboard/benefits?perk=<id>`) — open that
  // perk's detail sheet as soon as the list has loaded.
  const searchParams = useSearchParams();
  useEffect(() => {
    const wantedId = searchParams.get('perk');
    if (!wantedId || !data) return;
    const match = data.perks.find((p) => p.id === wantedId);
    if (match) openPerk(match);
  }, [searchParams, data]);
  const copyCode = () => {
    if (!perk?.discountCode) return;
    navigator.clipboard?.writeText(perk.discountCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-extrabold text-ink-700 tracking-tight" dir="rtl">{t('title')}</h1>
      <p className="text-sm text-ink-400" dir="rtl">{t('subtitle')}</p>

      {showCoreBanner && (
        <div className="flex items-center gap-3 rounded-card bg-card p-3.5" dir="rtl">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-600/15 text-base">
            <CoreRunnerBadge />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-700">{t('coreMemberTitle')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
              {t('coreMemberNote', { count: corePerks.length })}
            </p>
          </div>
        </div>
      )}

      {isLoading && !data ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} className="h-44" />)}
        </div>
      ) : perks.length === 0 ? (
        <EmptyState icon={Gift} title={t('noPerks')} className="py-10" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {perks.map((p) => (
            <button key={p.id} onClick={() => openPerk(p)} className="text-start">
              <Card variant="solid" className="!p-0 overflow-hidden h-full flex flex-col">
                <div className="aspect-[4/3] bg-white flex items-center justify-center p-3">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={title(p)} className="max-w-full max-h-full object-contain" />
                  ) : (
                    <Gift className="h-9 w-9 text-ink-500" />
                  )}
                </div>
                <div className="p-2.5 flex-1 flex flex-col">
                  <p className="text-sm font-semibold text-ink-700 truncate" dir="auto">{title(p)}</p>
                  <p className="text-xs text-ink-400 truncate mt-0.5" dir="auto">{p.sponsorName}</p>
                  {p.tier === 'core_runner' && (
                    <span className="inline-flex items-center gap-1 self-start mt-1.5 text-2xs font-bold px-2 py-0.5 rounded-full bg-accent-600/15 text-accent-900">
                      {/* The same 🌰 as the banner above and the profile name, so
                          the tag reads as "yours" at a glance rather than as a lock. */}
                      <CoreRunnerBadge />
                      {t('coreRunnerBadge')}
                    </span>
                  )}
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <Sheet open={!!perk} onOpenChange={(o) => !o && setPerk(null)} title={perk ? title(perk) : ''}>
        {perk && (
          <div className="space-y-3 pb-2">
            <div className="aspect-[16/9] rounded-xl bg-white flex items-center justify-center overflow-hidden p-4">
              {perk.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={perk.imageUrl} alt={title(perk)} className="max-w-full max-h-full object-contain" />
              ) : (
                <Gift className="h-10 w-10 text-ink-500" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-brand-600" dir="auto">{perk.sponsorName}</p>
              {perk.tier === 'core_runner' && (
                <span className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-0.5 rounded-full bg-accent-600/15 text-accent-900">
                  <CoreRunnerBadge />
                  {t('coreRunnerBadge')}
                </span>
              )}
            </div>
            {description(perk) && <p className="text-sm text-ink-500" dir="auto">{description(perk)}</p>}

            {perk.discountCode && (
              <div>
                <label className="block text-xs font-semibold text-ink-400 mb-1.5">{t('discountCode')}</label>
                <button
                  onClick={copyCode}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-page/50 border border-page/50 text-sm font-bold tabular-nums text-ink-700"
                  dir="ltr"
                >
                  {perk.discountCode}
                  {copied ? <CheckCircle2 className="h-4 w-4 text-accent-600" /> : <Copy className="h-4 w-4 text-ink-400" />}
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
