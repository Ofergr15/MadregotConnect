'use client';

import Link from 'next/link';
import { Gauge, MapPin } from 'lucide-react';
import { GROUP_HEX, cn } from '@/lib/utils';
import { BASEMAP_URL_TEMPLATE, fillTileTemplate } from '@/lib/basemap';
import { toMercator, TILE_SIZE } from '@/lib/activity/tiles';
import { KIND_LABEL, paceMatch, type MeetupPerson, type RunMeetup } from '@/lib/runs/meetups';

// The pieces of "לרוץ ביחד" (mockup ~/.cache/madregot/run-together-v2.html): a run's
// pack is its colour — on the card's edge, the pin and every face's ring — so where,
// which pack and who read at a glance (Ofer, 2026-10-19).

export const packHex = (pack: number | null | undefined) => (pack && pack >= 1 && pack <= 3 ? GROUP_HEX[pack - 1] : '#9A9BA5');
const PACK_TINT: Record<number, { bg: string; ink: string }> = {
  1: { bg: '#E4F5EA', ink: '#0E6B32' },
  2: { bg: '#E3F2FF', ink: '#0B5FA8' },
  3: { bg: '#FFEDE3', ink: '#B23A0C' },
};
export const KIND_TINT: Record<string, { bg: string; ink: string }> = {
  easy: { bg: '#E4F5EA', ink: '#0E6B32' },
  long: { bg: '#E8EAFF', ink: '#1525FF' },
  quality: { bg: '#FFEDE3', ink: '#B23A0C' },
  recovery: { bg: '#F0F0F4', ink: '#45464F' },
};
export const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

export function PackChip({ pack, small }: { pack: number | null; small?: boolean }) {
  if (!pack) return null;
  const t = PACK_TINT[pack];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-extrabold', small ? 'px-2 py-0.5 text-[11.5px]' : 'px-2.5 py-1 text-[12.5px]')} style={{ background: t.bg, color: t.ink }}>
      <i className="h-2 w-2 rounded-full" style={{ background: packHex(pack) }} />דבוקה {pack}
    </span>
  );
}

export function KindChip({ m }: { m: Pick<RunMeetup, 'kind' | 'distanceKm'> }) {
  const label = [m.kind ? KIND_LABEL[m.kind] : 'ריצה', m.distanceKm ? `${m.distanceKm} ק״מ` : null].filter(Boolean).join(' · ');
  const t = KIND_TINT[m.kind ?? 'recovery'];
  return <span className="shrink-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-black" style={{ background: t.bg, color: t.ink }}><bdi>{label}</bdi></span>;
}

export function MatchChip({ m, myPace }: { m: Pick<RunMeetup, 'plannedPace'>; myPace: string | null | undefined }) {
  const match = paceMatch(m.plannedPace, myPace);
  if (match !== 'close' && match !== 'near') return null;
  return <span className="shrink-0 whitespace-nowrap rounded-lg bg-brand-600 px-2 py-0.5 text-[11.5px] font-black text-white">בקצב שלך</span>;
}

export function Face({ p, size = 28, ring }: { p: MeetupPerson; size?: number; ring?: boolean }) {
  const style = { width: size, height: size, boxShadow: ring ? `0 0 0 2.5px ${packHex(p.pack)}` : undefined };
  return p.avatarUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.avatarUrl} alt="" style={style} className="shrink-0 rounded-full bg-page object-cover" referrerPolicy="no-referrer" />
    : <span style={style} className="flex shrink-0 items-center justify-center rounded-full bg-brand-600/15 text-[12px] font-black text-brand-600">{(p.name[0] || '?').toUpperCase()}</span>;
}

export function FaceStack({ people, size = 26, max = 3 }: { people: MeetupPerson[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="flex shrink-0" dir="ltr">
      {shown.map((p, i) => (
        <span key={p.id} className={cn('rounded-full border-2 border-card', i > 0 && '-ms-2')}><Face p={p} size={size} /></span>
      ))}
      {extra > 0 && <span style={{ width: size + 4, height: size + 4 }} className="-ms-2 flex items-center justify-center rounded-full border-2 border-card bg-brand-600/10 text-[10.5px] font-black text-brand-600">+{extra}</span>}
    </span>
  );
}

export const whoLine = (people: MeetupPerson[]) => {
  const names = people.map((p) => firstName(p.name)).filter(Boolean);
  return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
};

/**
 * A still map around a point — the app's own pale plate (lib/basemap), tiles laid out
 * so the point sits in the middle, with a pin in the pack's colour. No library, so a
 * list of cards costs a handful of cached tiles, not a map each.
 */
export function StaticMap({ lat, lng, zoom = 15, color, className, pinSize = 18 }: {
  lat: number; lng: number; zoom?: number; color: string; className?: string; pinSize?: number;
}) {
  const world = TILE_SIZE * 2 ** zoom;
  const { x, y } = toMercator({ lat, lng });
  const px = x * world, py = y * world;
  const tx = Math.floor(px / TILE_SIZE), ty = Math.floor(py / TILE_SIZE);
  const tiles: Array<{ key: string; src: string; left: number; top: number }> = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) {
    tiles.push({
      key: `${dx}:${dy}`,
      src: fillTileTemplate(BASEMAP_URL_TEMPLATE, zoom, tx + dx, ty + dy),
      left: (tx + dx) * TILE_SIZE - px,
      top: (ty + dy) * TILE_SIZE - py,
    });
  }
  return (
    <div className={cn('relative overflow-hidden bg-[#E9E9EC]', className)} dir="ltr" aria-hidden>
      {tiles.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.key} src={t.src} alt="" draggable={false} className="absolute max-w-none select-none" style={{ width: TILE_SIZE, height: TILE_SIZE, left: `calc(50% + ${t.left}px)`, top: `calc(50% + ${t.top}px)` }} />
      ))}
      <Pin color={color} size={pinSize} />
    </div>
  );
}

export function Pin({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <i className="absolute left-1/2 top-1/2 block rounded-[50%_50%_50%_0] border-[3px] border-white shadow-[0_3px_8px_rgba(0,0,0,0.35)]"
      style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size - 2, background: color, transform: 'rotate(-45deg)' }} />
  );
}

/** The board's card: time large, the pack's colour down its edge, where, who. */
export function RunCard({ m, myPace, dayLabel, className }: { m: RunMeetup; myPace: string | null | undefined; dayLabel: string; className?: string }) {
  const color = packHex(m.pack);
  return (
    <Link href={`/dashboard/run-together/${m.id}`}
      className={cn('relative flex gap-2.5 overflow-hidden rounded-[22px] bg-card p-3 ps-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-10px_rgba(0,0,0,0.14)] active:scale-[0.99]', className)}>
      <span className="absolute inset-y-0 start-0 w-[5px]" style={{ background: color }} aria-hidden />
      <span className="w-[54px] shrink-0 pt-0.5 text-center">
        <b className="block text-[21px] font-black leading-tight tracking-tight text-ink-900"><bdi>{m.startTime}</bdi></b>
        <small className="text-xs font-bold text-ink-400">{dayLabel}</small>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap gap-1"><KindChip m={m} /><MatchChip m={m} myPace={myPace} />{m.joined && <span className="rounded-lg bg-accent-600/15 px-2 py-0.5 text-[11.5px] font-black text-accent-900">מגיע/ה ✓</span>}</span>
        <span className="mt-1.5 flex items-center gap-1 truncate text-[14px] font-extrabold text-ink-900"><MapPin className="h-[15px] w-[15px] shrink-0 text-[#FF5315]" /><bdi className="truncate">{m.location}</bdi></span>
        <span className="mt-1.5 flex items-center gap-1.5">
          <PackChip pack={m.pack} small />
          {m.plannedPace && <span className="inline-flex items-center gap-0.5 text-[12.5px] font-extrabold text-ink-500"><Gauge className="h-3.5 w-3.5 text-ink-300" /><bdi>{m.plannedPace}</bdi></span>}
        </span>
        <span className="mt-2 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[12.5px] text-ink-500">
          <FaceStack people={m.going} size={24} />
          <b className="truncate font-extrabold text-ink-900"><bdi>{whoLine(m.going)}</bdi></b>
        </span>
      </span>
      {m.lat != null && m.lng != null && (
        <StaticMap lat={m.lat} lng={m.lng} color={color} className="h-[74px] w-[74px] shrink-0 self-center rounded-2xl" />
      )}
    </Link>
  );
}
