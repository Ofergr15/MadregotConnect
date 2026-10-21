'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Sheet, SkeletonList } from '@/components/ui';
import { cn } from '@/lib/utils';

// "הגרעין שלי" (mockup ~/.cache/madregot/core-perks, Ofer 10-21): a core runner's own
// page — a gold card, then the core perks, each with ONE status line the admin keeps
// current (club_perks.status_he, migration 167; no counting). Tapping a perk opens its
// sheet: where to redeem on a map with navigation, WhatsApp, the website. Arriving from
// the "ברוכים הבאים לגרעין" push (?welcome=1) opens the welcome sheet first.

interface Loc { name: string; query: string }
interface CorePerk {
  id: string; sponsorName: string; title: string; description: string | null; imageUrl: string | null;
  discountCode: string | null; redeemUrl: string | null;
  status: string | null; tone: 'now' | 'soon' | 'tbd' | null; where: string | null;
  locations: Loc[]; whatsapp: string | null; website: string | null;
}
interface Data { preview: boolean; name: string | null; clubCount: number; perks: CorePerk[] }

const TONE = { now: 'bg-[#DCFCE7] text-[#15803d]', soon: 'bg-[#E0EBFF] text-[#1f6feb]', tbd: 'bg-page text-ink-400' };
const mapEmbed = (q: string) => `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
const mapLink = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

export default function CorePage() {
  return <Suspense><CoreScreen /></Suspense>;
}

function Logo({ p, size = 46 }: { p: CorePerk; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-[12px] bg-page text-center text-[11px] font-black leading-tight text-ink-900" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-full w-full object-contain p-1" /> : p.sponsorName}
    </span>
  );
}

function CoreScreen() {
  const { data, error } = useApi<Data>('/api/perks/core');
  const welcome = useSearchParams().get('welcome') === '1';
  const [hello, setHello] = useState(false);
  const [open, setOpen] = useState<CorePerk | null>(null);
  useEffect(() => { if (welcome) setHello(true); }, [welcome]);
  const first = (data?.name || '').trim().split(/\s+/)[0];
  const perks = data?.perks ?? [];
  const now = perks.filter((p) => p.tone === 'now').length;
  const soon = perks.filter((p) => p.tone === 'soon').length;

  return (
    <div className="pb-8" dir="rtl">
      <div className="flex h-11 items-center">
        <Link href="/dashboard/profile" className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ פרופיל</Link>
      </div>
      {error && <p className="text-sm font-bold text-accent-red-ink">ההטבות כאן הן לרצי הגרעין</p>}
      {!data && !error && <SkeletonList count={4} />}
      {data && (
        <>
          <section className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#1a1a1a] via-[#3a2f12] to-[#7a5c12] p-4 text-white">
            <span aria-hidden className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(255,214,0,0.35),transparent_70%)]" />
            <p className="text-[12px] font-extrabold tracking-[0.5px] text-[#FFD600]">MADREGOT CORE{data.preview ? ' · תצוגה' : ''}</p>
            <h1 dir="auto" className="mt-1 text-[24px] font-black">{data.name || 'הגרעין'}</h1>
            <p className="text-[12.5px] opacity-75">רץ/ת גרעין במדרגות</p>
            <div className="mt-3 flex gap-2">
              {[[perks.length, 'הטבות גרעין'], [now, 'זמינות עכשיו'], [soon, 'בקרוב']].map(([n, l]) => (
                <div key={String(l)} className="flex-1 rounded-[12px] bg-white/10 py-2 text-center">
                  <b className="block text-[18px]">{n}</b><span className="text-[11px] opacity-75">{l}</span>
                </div>
              ))}
            </div>
          </section>

          <p className="px-1 pb-1.5 pt-4 text-13 font-extrabold text-ink-400">🌟 רק לגרעין</p>
          <div className="space-y-2">
            {perks.map((p) => (
              <button key={p.id} type="button" onClick={() => setOpen(p)}
                className="flex w-full items-center gap-3 rounded-[16px] border-[1.5px] border-[#E7C04A] bg-gradient-to-br from-[#fffaf0] to-white px-3 py-2.5 text-start active:opacity-80">
                <Logo p={p} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[15px] text-ink-900" dir="auto">{p.title}</b>
                  {p.where && <small className="block text-[12.5px] font-bold text-ink-700">{p.where}</small>}
                  {p.status && <span className={cn('mt-1 inline-block rounded-[8px] px-2 py-0.5 text-[11.5px] font-extrabold', TONE[p.tone ?? 'tbd'])}>{p.status}</span>}
                </span>
                <span className="text-[#c4c4c9]">‹</span>
              </button>
            ))}
          </div>

          {data.clubCount > 0 && (
            <Link href="/dashboard/benefits" className="mt-3 flex min-h-[52px] items-center gap-3 rounded-[16px] bg-card px-4">
              <span className="text-[20px]">🎁</span>
              <span className="min-w-0 flex-1"><b className="block text-[15px] text-ink-900">והטבות המועדון</b><small className="text-12 text-ink-400">{data.clubCount} הטבות לכל חברי המדרגות</small></span>
              <span className="text-[#c4c4c9]">‹</span>
            </Link>
          )}
        </>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.sponsorName ?? ''}>
        {open && <PerkSheet p={open} />}
      </Sheet>

      <Sheet open={hello && !!data} onOpenChange={setHello} title="">
        <div className="px-4 pb-6" dir="rtl">
          <section className="rounded-[20px] bg-gradient-to-br from-[#1a1a1a] via-[#3a2f12] to-[#7a5c12] p-4 text-white">
            <p className="text-[12px] font-extrabold text-[#FFD600]">MADREGOT CORE</p>
            <h2 className="mt-1 text-[24px] font-black">{first ? `${first}, ` : ''}ברוך/ה הבא/ה לגרעין 🌟</h2>
            <p className="mt-1 text-[13px] opacity-80">הצוות בחר בך. הנה מה שמגיע לך מעכשיו.</p>
            <div className="mt-3 flex gap-2">
              <div className="flex-1 rounded-[12px] bg-white/10 py-2 text-center"><b className="block text-[18px]">{perks.length}</b><span className="text-[11px] opacity-75">הטבות גרעין</span></div>
              <div className="flex-1 rounded-[12px] bg-white/10 py-2 text-center"><b className="block text-[18px]">+{data?.clubCount ?? 0}</b><span className="text-[11px] opacity-75">הטבות מועדון</span></div>
            </div>
          </section>
          <button type="button" onClick={() => setHello(false)} className="mt-3 min-h-[50px] w-full rounded-[14px] bg-ink-900 text-[16px] font-extrabold text-white">לראות את ההטבות שלי</button>
        </div>
      </Sheet>
    </div>
  );
}

function PerkSheet({ p }: { p: CorePerk }) {
  const [at, setAt] = useState(0);
  const loc = p.locations[at];
  return (
    <div className="space-y-3 px-4 pb-8" dir="rtl">
      <div className="flex items-center gap-3">
        <Logo p={p} size={52} />
        <span className="min-w-0">
          <b className="block text-[18px] text-ink-900" dir="auto">{p.title}</b>
          {p.status && <span className={cn('mt-0.5 inline-block rounded-[8px] px-2 py-0.5 text-[12px] font-extrabold', TONE[p.tone ?? 'tbd'])}>{p.status}</span>}
        </span>
      </div>
      {p.description && <p dir="auto" className="text-[14px] leading-relaxed text-ink-700">{p.description}</p>}
      {p.where && <p className="text-[14px] font-bold text-ink-900">{p.where}</p>}
      {loc && (
        <>
          <iframe title={loc.name} src={mapEmbed(loc.query)} loading="lazy" className="h-[190px] w-full rounded-[14px] border-0" referrerPolicy="no-referrer-when-downgrade" />
          <div className="overflow-hidden rounded-[14px] bg-page">
            {p.locations.map((l, i) => (
              <div key={l.name} className={cn('flex min-h-[52px] items-center gap-2 px-3', i > 0 && 'border-t-[0.5px] border-black/[0.08]')}>
                <button type="button" onClick={() => setAt(i)} className="min-w-0 flex-1 text-start">
                  <b className={cn('block text-[15px]', i === at ? 'text-ink-900' : 'text-ink-500')} dir="auto">📍 {l.name}</b>
                </button>
                <a href={mapLink(l.query)} target="_blank" rel="noreferrer" className="min-h-[36px] rounded-full bg-[#1f6feb] px-3 py-2 text-13 font-bold text-white">ניווט</a>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="flex gap-2">
        {p.whatsapp && <a href={`https://wa.me/${p.whatsapp}`} target="_blank" rel="noreferrer" className="flex min-h-[48px] flex-1 items-center justify-center rounded-[14px] bg-[#25D366] text-[15px] font-extrabold text-white">וואטסאפ</a>}
        {(p.website || p.redeemUrl) && <a href={p.website || p.redeemUrl!} target="_blank" rel="noreferrer" className="flex min-h-[48px] flex-1 items-center justify-center rounded-[14px] bg-ink-900 text-[15px] font-extrabold text-white">לאתר</a>}
      </div>
      {p.discountCode && <p className="rounded-[12px] bg-page px-3 py-2 text-center text-[15px]">קוד: <b dir="ltr">{p.discountCode}</b></p>}
    </div>
  );
}
