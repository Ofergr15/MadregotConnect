'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, Star, User } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, resolveGroup } from '@/lib/utils';
import { useIsSuperUser } from '@/lib/impersonation';
import { ACADEMY_SQUAD, FAVORITES_SQUAD, MINE_SQUAD } from '@/lib/feed/squad-filter';
import { setFeedScope, useFeedScope, type FeedKind } from '@/lib/feed/scope-store';
import { prefetchScopes } from '@/lib/feed/scope-cache';

// ═════════════════════════════════════════════════════════════════════════════
// THE CLUB LOGO IS THE FEED'S FILTER (feed redesign, 2026-10-12).
//
// Ofer: the second chip row ("all packs · mine · 1 · 2 · 3 · academy ·
// favourites") scrolled sideways inside the page margins and was cut mid-word on
// a phone, with "favourites" never on screen. So on /feed the logo carries the
// scope beside it ("המועדון ▾", or the pack in its colour) and opens one panel:
// "what" on top (all / runs / updates), "of whom" under it — the club, the packs
// (yours first and marked), mine, favourites, the academy. Pick and it closes.
// Mockup: ~/.cache/madregot/feed-redesign/mockup-v2.html, screen "לחיצה על הלוגו".
// ═════════════════════════════════════════════════════════════════════════════

/** How many flagged athletes the academy needs before it is offered (aae77577). */
const MIN_ACADEMY = 2;

const KINDS: Array<{ key: FeedKind; labelKey: 'filterAll' | 'filterRuns' | 'filterSocial' }> = [
  { key: 'all', labelKey: 'filterAll' },
  { key: 'runs', labelKey: 'filterRuns' },
  { key: 'social', labelKey: 'filterSocial' },
];

export function FeedScopeButton({ myGroupId }: { myGroupId: string | null }) {
  const t = useTranslations('feed');
  const scope = useFeedScope();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // "Only my workouts" stays where it was: the super user, until rollout.
  const showMine = useIsSuperUser();
  const { data: groupsData } = useApi<{ groups?: { id: string; name: string }[]; academyCount?: number | null }>('/api/groups');

  const packs = useMemo(() => {
    const list = (groupsData?.groups || [])
      .map((g) => {
        const r = resolveGroup(g.name);
        return { id: g.id, index: r.index, hex: r.hex, label: r.index >= 0 ? t('filterSquadN', { n: r.index + 1 }) : g.name, goal: g.name.split(' - ')[1] || '' };
      })
      .sort((a, b) => (a.index < 0 ? 99 : a.index) - (b.index < 0 ? 99 : b.index));
    // Yours first: it is the one most people want, every day.
    const mine = list.findIndex((p) => p.id === myGroupId);
    if (mine > 0) list.unshift(...list.splice(mine, 1));
    return list;
  }, [groupsData, myGroupId, t]);
  const academyCount = groupsData?.academyCount;
  const showAcademy = academyCount == null || academyCount >= MIN_ACADEMY;

  const current = packs.find((p) => p.id === scope.squad);
  const label = current ? current.label
    : scope.squad === MINE_SQUAD ? t('scopeMine')
      : scope.squad === FAVORITES_SQUAD ? t('filterFavorites')
        : scope.squad === ACADEMY_SQUAD ? t('filterAcademy')
          : t('scopeClub');
  const ring = current?.hex ?? (scope.squad === FAVORITES_SQUAD ? '#FF9F0A' : scope.squad ? '#2D2E38' : null);
  const kindLabel = t(KINDS.find((k) => k.key === scope.kind)!.labelKey);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pick = (squad: string | null) => { setFeedScope({ squad }); setOpen(false); };

  const row = (key: string, active: boolean, onClick: () => void, icon: React.ReactNode, title: React.ReactNode, sub?: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-2.5 text-start active:opacity-70', active && 'bg-card shadow-[0_1px_4px_rgba(0,0,0,0.07)]')}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold text-ink-900">{title}</span>
        {sub && <span className="block text-xs text-ink-400">{sub}</span>}
      </span>
      {active && <Check className="h-4 w-4 text-brand-600" strokeWidth={3} />}
    </button>
  );
  const disc = (bg: string, content: React.ReactNode) => (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: bg }}>{content}</span>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Warm every option the moment the panel opens, so the tap that
          // follows usually lands on a page that is already here.
          if (!open) prefetchScopes([null, ...packs.map((p) => p.id), FAVORITES_SQUAD, ...(showMine ? [MINE_SQUAD] : [])].map((squad) => ({ kind: scope.kind, squad })));
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center gap-2.5 -m-1 p-1 active:opacity-80"
        data-testid="feed-scope"
      >
        <span
          className="relative flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-[0_0_0_0.5px_rgba(60,60,67,0.22),0_2px_6px_rgba(0,0,0,0.06)]"
          style={ring ? { boxShadow: `0 0 0 2.5px ${ring}` } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="Madregot" className="h-8 w-8 object-contain" />
        </span>
        <span className="min-w-0 text-start leading-tight">
          <span className="flex items-center gap-1 text-[17px] font-extrabold tracking-tight text-ink-900" style={current ? { color: current.hex } : undefined}>
            {label}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} strokeWidth={2.8} />
          </span>
          <span className="block text-xs text-ink-400">{kindLabel}</span>
        </span>
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[70]" dir="rtl" role="dialog" aria-modal="true" aria-label={t('scopeTitle')}>
          <button type="button" aria-label={t('scopeClose')} className="absolute inset-0 bg-black/20" onClick={() => setOpen(false)} />
          <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+60px)] w-[min(320px,calc(100vw-24px))] rounded-[26px] bg-page/95 p-2 shadow-[0_30px_70px_rgba(0,0,0,0.28),0_0_0_0.5px_rgba(0,0,0,0.06)] backdrop-blur-xl">
            <div className="m-1.5 mb-2 flex h-9 rounded-xl bg-ink-300/25 p-0.5" role="radiogroup" aria-label={t('scopeWhat')}>
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  role="radio"
                  aria-checked={scope.kind === k.key}
                  onClick={() => setFeedScope({ kind: k.key })}
                  className={cn('flex-1 rounded-[10px] text-sm font-semibold text-ink-900', scope.kind === k.key && 'bg-card font-bold shadow-[0_3px_8px_rgba(0,0,0,0.12)]')}
                >
                  {t(k.labelKey)}
                </button>
              ))}
            </div>
            {row('club', !scope.squad, () => pick(null),
              // eslint-disable-next-line @next/next/no-img-element
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card shadow-[inset_0_0_0_1px_rgba(60,60,67,0.15)]"><img src="/images/logo.png" alt="" className="h-7 w-7 object-contain" /></span>,
              t('scopeClub'))}
            {packs.length > 0 && <p className="px-3 pb-1 pt-2.5 text-xs font-bold text-ink-400">{t('scopePacks')}</p>}
            {packs.map((p) => row(p.id, scope.squad === p.id, () => pick(p.id),
              disc(p.hex, p.index >= 0 ? p.index + 1 : '•'),
              <>{p.label}{p.id === myGroupId && <span className="rounded-pill bg-brand-600/10 px-1.5 py-px text-[10.5px] font-extrabold text-brand-600">{t('scopeYours')}</span>}</>,
              p.goal || undefined))}
            <div className="mx-3 my-1.5 h-px bg-ink-300/40" />
            {showMine && row('mine', scope.squad === MINE_SQUAD, () => pick(MINE_SQUAD), disc('#1D1E26', <User className="h-4 w-4" />), t('scopeMine'))}
            {row('fav', scope.squad === FAVORITES_SQUAD, () => pick(FAVORITES_SQUAD), disc('linear-gradient(140deg,#FFC93C,#FF9F0A)', <Star className="h-4 w-4 fill-current" />), t('filterFavorites'))}
            {showAcademy && row('academy', scope.squad === ACADEMY_SQUAD, () => pick(ACADEMY_SQUAD), disc('#5856D6', '🎓'), t('filterAcademy'))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
