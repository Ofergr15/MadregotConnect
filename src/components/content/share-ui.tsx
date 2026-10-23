'use client';

import Link from 'next/link';
import { useApi } from '@/lib/api';
import { FeedAvatar } from '@/components/FeedAvatar';
import { useQualitySessionAccess } from '@/lib/quality-session/use-access';
import { LastLine, TypeBlock } from '@/components/content/hub-ui';
import type { ShareDays } from '@/app/api/quality-session/days/route';

// ═════════════════════════════════════════════════════════════════════════════
// Content › "שיתוף האימון" (mockups/content-share.html, Ofer 10-23: "why isn't it in
// Content?"). The morning's pack cards used to live only in the feed row, 07:00–11:00.
// Here they are always: on a quality or long-run day "מחכה לך" with each pack's
// suggested runner, until the day ends; the last session under it. Every door opens
// the existing share screen (/dashboard/quality-session).
// ═════════════════════════════════════════════════════════════════════════════

const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const dowOf = (d: string) => DOW[new Date(`${d}T12:00:00Z`).getUTCDay()];
export const dm = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;
export const kindOf = (x: { long: boolean }) => (x.long ? 'ריצה ארוכה' : 'אימון איכות');
/** The session's own name, unless it is just the weekday ("שלישי") — then its kind. */
export const titleOf = (x: { date: string; name: string; long: boolean }) => {
  const n = (x.name || '').trim();
  return !n || n === dowOf(x.date) || n === `יום ${dowOf(x.date)}` ? kindOf(x) : n;
};
export const shareHref = (date: string, all = false) => `/dashboard/quality-session?date=${date}${all ? '&all=1' : ''}`;

export function useShareDays() {
  const access = useQualitySessionAccess();
  const res = useApi<ShareDays>(access ? '/api/quality-session/days' : null, { refreshInterval: 60_000 });
  return { access, ...res };
}

/** The suggested runners' faces, overlapping. */
export function Faces({ packs, ring = 'var(--c2)' }: { packs: NonNullable<ShareDays['today']>['packs']; ring?: string }) {
  return (
    <span className="flex shrink-0">
      {packs.filter((x) => x.top).map((x, i) => (
        <span key={x.pack} className="block h-[30px] w-[30px] overflow-hidden rounded-full border-2" style={{ borderColor: ring, marginInlineStart: i ? -8 : 0 }}>
          <FeedAvatar name={x.top!.name} url={x.top!.avatarUrl} className="h-full w-full text-[10px]" />
        </span>
      ))}
    </span>
  );
}

/** The hub's block: nothing for whoever cannot open the share screen. */
export function ShareBlock() {
  const { access, data } = useShareDays();
  if (!access) return null;
  const t = data?.today;
  const last = data?.past[0];
  return (
    <TypeBlock type="share">
      {t && (
        <div className="mx-2.5 mb-2.5 flex items-center gap-2.5 rounded-[13px] py-[9px] pe-[9px] ps-2.5" style={{ background: 'var(--c2)' }}>
          <Faces packs={t.packs} />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-extrabold tracking-[0.2px]" style={{ color: 'var(--ci)' }}>
              היום · {kindOf(t)} · <bdi dir="ltr">{t.runs}</bdi> סיימו
            </span>
            <span className="mt-px block truncate text-[14px] font-semibold text-ink-900">רץ מכל דבוקה, מוכן</span>
          </span>
          <Link href={shareHref(t.date, true)} className="inline-flex min-h-[36px] shrink-0 items-center rounded-full px-[13px] text-[13px] font-bold text-white" style={{ background: 'var(--c)' }}>לשתף</Link>
        </div>
      )}
      {last && <LastLine first={!t} label="אחרון" title={`${dowOf(last.date)} ${dm(last.date)} · ${titleOf(last)} · ${last.runs} ריצות`} href={shareHref(last.date)} />}
    </TypeBlock>
  );
}
