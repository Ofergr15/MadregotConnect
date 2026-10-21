'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, MapPin } from 'lucide-react';
import { useApi } from '@/lib/api';
import { Sheet, SkeletonList } from '@/components/ui';
import { cn } from '@/lib/utils';

// "הגרעין שלי" v2 (mockup ~/.cache/madregot/core-perks-v2, Ofer 10-21: "the maps aren't
// nice — make the whole page more professional"). A member card like a wallet pass, the
// perks grouped by state with the sponsors' own logos, and a sheet per perk: the big
// numbers, where to redeem as clean location rows with Waze and Maps (no embedded map),
// "איך זה עובד", and one main action (WhatsApp / website). Status lines are the admin's
// (club_perks.status_he, 167); numbers and steps are highlights / how_he (168).

interface Loc { name: string; query: string }
interface CorePerk {
  id: string; sponsorName: string; title: string; description: string | null; imageUrl: string | null;
  discountCode: string | null; redeemUrl: string | null;
  status: string | null; tone: 'now' | 'soon' | 'tbd' | null; where: string | null;
  locations: Loc[]; whatsapp: string | null; website: string | null;
  highlights?: Array<{ n: string; label: string }>; how?: string[];
}
interface Data { preview: boolean; name: string | null; clubCount: number; perks: CorePerk[] }

const PILL = { now: 'bg-[#E8F7EE] text-[#15803d]', soon: 'bg-[#EAF1FF] text-[#1f6feb]', tbd: 'bg-page text-ink-400' };
const waze = (q: string) => `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;
const maps = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const YEAR = new Date().getFullYear();

export default function CorePage() {
  return <Suspense><CoreScreen /></Suspense>;
}

function Pill({ p }: { p: CorePerk }) {
  if (!p.status) return null;
  return (
    <span className={cn('mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-extrabold', PILL[p.tone ?? 'tbd'])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />{p.status}
    </span>
  );
}

function Logo({ p, size }: { p: CorePerk; size: number }) {
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden border border-[#ececf0] bg-white text-center text-[11px] font-black leading-tight text-ink-900"
      style={{ width: size, height: size, borderRadius: size * 0.28 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ maxWidth: size * 0.84, maxHeight: size * 0.84 }} className="object-contain" /> : p.sponsorName}
    </span>
  );
}

function CoreScreen() {
  const { data, error } = useApi<Data>('/api/perks/core');
  const welcome = useSearchParams().get('welcome') === '1';
  const [hello, setHello] = useState(false);
  const [open, setOpen] = useState<CorePerk | null>(null);
  useEffect(() => { if (welcome) setHello(true); }, [welcome]);
  const perks = data?.perks ?? [];
  const groups: Array<[string, string, CorePerk[]]> = [
    ['זמין עכשיו', '#15803d', perks.filter((p) => p.tone === 'now')],
    ['בקרוב', '#1f6feb', perks.filter((p) => p.tone === 'soon')],
    ['עוד', '#8e8e93', perks.filter((p) => p.tone !== 'now' && p.tone !== 'soon')],
  ];
  const first = (data?.name || '').trim().split(/\s+/)[0];

  return (
    <div className="pb-10" dir="rtl">
      <div className="flex h-11 items-center">
        <Link href="/dashboard/profile" className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ פרופיל</Link>
      </div>
      {error && <p className="rounded-[16px] bg-card px-4 py-3 text-sm text-ink-500">ההטבות כאן הן לרצי הגרעין.</p>}
      {!data && !error && <SkeletonList count={4} />}
      {data && (
        <>
          <MemberCard name={data.name} preview={data.preview} perks={perks} />
          {groups.map(([label, color, list]) => list.length > 0 && (
            <section key={label}>
              <div className="flex items-center gap-[7px] px-1 pb-2 pt-5 text-13 font-extrabold text-ink-700">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: color }} />{label}
              </div>
              <div className="space-y-2">
                {list.map((p) => (
                  <button key={p.id} type="button" onClick={() => setOpen(p)}
                    className="flex w-full items-center gap-3 rounded-[18px] bg-card p-3 text-start shadow-[0_1px_2px_rgba(0,0,0,0.05)] active:opacity-80">
                    <Logo p={p} size={52} />
                    <span className="min-w-0 flex-1">
                      <b dir="auto" className="block text-[15.5px] tracking-[-0.1px] text-ink-900">{p.title}</b>
                      {(p.locations.length > 0 || p.where) && (
                        <small className="block truncate text-[12.5px] text-ink-400">
                          {p.locations.length ? p.locations.map((l) => l.name.replace(/^HOKA\s*/, '')).join(' · ') : p.where}
                        </small>
                      )}
                      <Pill p={p} />
                    </span>
                    <ChevronLeft className="h-5 w-5 shrink-0 text-[#c4c4c9]" />
                  </button>
                ))}
              </div>
            </section>
          ))}
          {data.clubCount > 0 && (
            <Link href="/dashboard/benefits" className="mt-5 flex min-h-[56px] items-center gap-3 rounded-[18px] bg-card px-4">
              <span className="text-[20px]">🎁</span>
              <span className="min-w-0 flex-1"><b className="block text-[15px] text-ink-900">והטבות המועדון</b><small className="text-12 text-ink-400">{data.clubCount} הטבות לכל חברי המדרגות</small></span>
              <ChevronLeft className="h-5 w-5 text-[#c4c4c9]" />
            </Link>
          )}
        </>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="">
        {open && <PerkSheet p={open} />}
      </Sheet>

      <Sheet open={hello && !!data} onOpenChange={setHello} title="">
        <div className="space-y-3 px-4 pb-6" dir="rtl">
          <MemberCard name={data?.name ?? null} preview={false} perks={perks} welcome={first} />
          <button type="button" onClick={() => setHello(false)} className="min-h-[52px] w-full rounded-[16px] bg-ink-900 text-[16px] font-extrabold text-white">לראות את ההטבות שלי</button>
        </div>
      </Sheet>
    </div>
  );
}

/** The wallet-pass card: logo, CORE · year, the name, the three counts. */
function MemberCard({ name, preview, perks, welcome }: { name: string | null; preview: boolean; perks: CorePerk[]; welcome?: string }) {
  const now = perks.filter((p) => p.tone === 'now').length;
  const soon = perks.filter((p) => p.tone === 'soon').length;
  return (
    <section className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#0d0d0d] via-[#1c1709] to-[#3d2d06] p-[18px] text-white shadow-[0_18px_40px_-18px_rgba(122,92,18,0.7)]">
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(115deg,rgba(255,214,0,0.05)_0_2px,transparent_2px_14px)]" />
      <span aria-hidden className="pointer-events-none absolute -end-20 -top-28 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(255,214,0,0.28),transparent_65%)]" />
      <div className="relative flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-white"><img src="/images/logo.png" alt="" className="h-[34px] w-[34px] object-contain" /></span>
        <span className="text-[11px] font-black tracking-[2px] text-[#FFD600]">CORE · {YEAR}{preview ? ' · תצוגה' : ''}</span>
      </div>
      <h1 dir="auto" className="relative mt-5 text-[26px] font-black tracking-[-0.3px]">
        {welcome ? `${welcome}, ברוך/ה הבא/ה לגרעין 🌟` : name || 'הגרעין'}
      </h1>
      <p className="relative mt-0.5 text-[12.5px] text-white/70">{welcome ? 'הצוות בחר בך. הנה מה שמגיע לך מעכשיו.' : 'רץ/ת גרעין · מדרגות'}</p>
      <div className="relative mt-4 flex border-t border-[#FFD600]/25 pt-3">
        {[[perks.length, 'הטבות'], [now, 'זמינות עכשיו'], [soon, 'בקרוב']].map(([n, l]) => (
          <div key={String(l)} className="flex-1"><b className="block text-[20px] font-black">{n}</b><span className="text-[11px] text-white/65">{l}</span></div>
        ))}
      </div>
    </section>
  );
}

function PerkSheet({ p }: { p: CorePerk }) {
  const hl = p.highlights ?? [];
  const how = p.how ?? [];
  const primary = p.whatsapp
    ? { href: `https://wa.me/${p.whatsapp}`, label: '💬 לקבוע בוואטסאפ', cls: 'bg-[#25D366] text-white' }
    : p.website || p.redeemUrl
      ? { href: (p.website || p.redeemUrl)!, label: 'לאתר', cls: 'bg-ink-900 text-white' }
      : null;
  return (
    <div className="pb-6" dir="rtl">
      <div className="px-4 pb-4 text-center">
        <span className="mx-auto block w-fit"><Logo p={p} size={72} /></span>
        <h2 dir="auto" className="mt-2.5 text-[21px] font-black text-ink-900">{p.title}</h2>
        <Pill p={p} />
      </div>
      <div className="space-y-2.5 bg-page px-3 pb-2 pt-3">
        {hl.length > 0 && (
          <Block title={p.sponsorName === 'HOKA' ? 'מה מגיע לך השנה' : 'מה מגיע לך'}>
            <div className="flex gap-2">
              {hl.map((h) => (
                <div key={h.label} className="flex-1 rounded-[12px] bg-[#f7f7fa] px-1.5 py-2.5 text-center">
                  <b dir="ltr" className="block text-[22px] font-black text-ink-900">{h.n}</b><span className="text-[11.5px] text-ink-500">{h.label}</span>
                </div>
              ))}
            </div>
          </Block>
        )}
        {!hl.length && p.description && <Block title="מה זה"><p dir="auto" className="text-[14px] leading-relaxed text-ink-700">{p.description}</p></Block>}
        {p.locations.length > 0 && (
          <Block title={p.locations.length > 1 ? 'איפה מממשים' : 'הסניף'}>
            {p.locations.map((l, i) => (
              <div key={l.name} className={cn('flex items-center gap-3 py-2', i > 0 && 'border-t border-[#f0f0f3]')}>
                <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[#e8eee2]">
                  <span aria-hidden className="absolute inset-x-0 top-[30%] h-[5px] -rotate-6 bg-white" />
                  <span aria-hidden className="absolute inset-y-0 start-[30%] w-1 rotate-6 bg-white" />
                  <span aria-hidden className="absolute inset-y-0 end-[22%] w-1 rotate-6 bg-[#f6d27a]" />
                  <MapPin className="relative h-6 w-6 fill-[#E5484D] text-white" />
                </span>
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[15px] text-ink-900">{l.name}</b>
                  <small className="block truncate text-12 text-ink-400">{p.where && p.locations.length === 1 ? p.where.replace(/^הסניף\s*/, '') : 'לחיצה לניווט'}</small>
                </span>
                <a href={waze(l.query)} target="_blank" rel="noreferrer" className="min-h-[34px] rounded-full bg-[#33CCFF] px-3 py-2 text-[12.5px] font-extrabold text-[#063041]">Waze</a>
                <a href={maps(l.query)} target="_blank" rel="noreferrer" className="min-h-[34px] rounded-full bg-page px-3 py-2 text-[12.5px] font-extrabold text-ink-900">מפות</a>
              </div>
            ))}
          </Block>
        )}
        {how.length > 0 && (
          <Block title={p.whatsapp ? 'איך קובעים' : 'איך זה עובד'}>
            <ol className="space-y-1 text-[14px] leading-relaxed text-ink-700">
              {how.map((h, i) => <li key={i} className="flex gap-2"><b className="text-ink-400">{i + 1}.</b>{h}</li>)}
            </ol>
          </Block>
        )}
        {p.discountCode && <Block title="קוד"><p dir="ltr" className="text-center text-[18px] font-black tracking-[1px] text-ink-900">{p.discountCode}</p></Block>}
      </div>
      {primary && (
        <div className="px-3 pt-3">
          <a href={primary.href} target="_blank" rel="noreferrer" className={cn('flex min-h-[54px] items-center justify-center rounded-[16px] text-[16px] font-black', primary.cls)}>{primary.label}</a>
        </div>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[18px] bg-card px-3.5 py-3">
      <h3 className="mb-2 text-[12.5px] font-extrabold text-ink-400">{title}</h3>
      {children}
    </section>
  );
}
