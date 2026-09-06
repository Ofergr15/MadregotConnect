'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { formatActivityTime } from '@/lib/utils';
import { FeedAvatar } from '@/components/FeedAvatar';
import { RouteMinimap } from '@/components/RouteMinimap';
import { FeedBodyText } from '@/components/FeedBodyText';
import {
  AuthorRow,
  ActionRow,
  ActivityChips,
  ActivityStatTiles,
  PlanVerdictChip,
  formatDuration,
  formatPace,
} from '@/components/FeedCard';
import type { RunGroup } from '@/lib/feed/group-runs';
import type { FeedItem } from '@/lib/feed/project';

/**
 * One club run that several people recorded separately, as a single card.
 *
 * ── The two things that make this different from Strava's version ─────────────
 * 1. It is symmetric. Strava picks one run as "the" activity and lists the others
 *    as people you "ran with"; here nobody is the host — `groupFeedItems` builds
 *    the transitive closure, so the same card appears in everyone's feed with the
 *    same names on it.
 * 2. Only the first two runners are expanded. Strava gives every athlete a full
 *    block, which at club scale — a דבוקה of eight — is a card three screens
 *    tall. The rest collapse to name, distance and pace, one tap from full.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────
 * It does not merge the underlying feed_items. Every runner keeps their own row,
 * their own likes and their own comment thread, which is why each expanded block
 * carries its own ActionRow: a kudos is a gesture toward a person, not toward a
 * card.
 *
 * ── Masking ──────────────────────────────────────────────────────────────────
 * Nothing here reads a raw activity row. Every number comes off a projected
 * `FeedItem`, so a runner who hid their pace or HR arrives with those fields
 * already null and renders as "—" — being on a card next to a teammate who hid
 * nothing cannot expose them. See the header of `lib/feed/group-runs.ts`.
 */

/** How many runners get the full treatment before the card starts collapsing. */
const EXPANDED_COUNT = 2;

/** Overlapping avatars, newest-first, capped — the group's face at a glance. */
function AvatarStack({ items }: { items: FeedItem[] }) {
  const shown = items.slice(0, 4);
  return (
    <div className="flex items-center">
      {shown.map((item, i) => (
        <div
          key={item.id}
          className={`rounded-full ring-2 ring-card ${i > 0 ? '-ms-2.5' : ''}`}
          style={{ zIndex: shown.length - i }}
        >
          <FeedAvatar name={item.author.name} url={item.author.avatarUrl} />
        </div>
      ))}
    </div>
  );
}

/** A collapsed runner: who, how far, how fast. Enough to decide whether to open it. */
function CompactRunner({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  const t = useTranslations('feed');
  const act = item.activity!;
  const pace = act.averagePace ? formatPace(act.averagePace) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="flex items-center gap-2.5 py-2 rounded-xl cursor-pointer transition-colors hover:bg-page/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
    >
      <FeedAvatar
        name={item.author.name}
        url={item.author.avatarUrl}
        className="w-7 h-7"
        textClassName="text-[10px]"
      />
      <p className="flex-1 min-w-0 text-13 font-semibold text-ink-700 truncate">
        {item.author.name}
      </p>
      <p className="text-xs text-ink-500 tabular-nums shrink-0">
        {(act.distance / 1000).toFixed(1)} {t('km')}
        {pace ? ` · ${pace}` : ''}
      </p>
      <ChevronRight className="h-3.5 w-3.5 text-ink-300 shrink-0 rtl:rotate-180" />
    </div>
  );
}

/** One runner's full block — the same numbers their solo card would have shown. */
function ExpandedRunner({
  item,
  myAthleteId,
  isStaff,
  onComment,
  onDelete,
}: {
  item: FeedItem;
  myAthleteId: string | null;
  isStaff: boolean;
  onComment: (item: FeedItem) => void;
  onDelete?: (item: FeedItem) => void;
}) {
  const t = useTranslations('feed');
  const router = useRouter();
  const act = item.activity!;
  const openDetail = () => router.push(`/dashboard/activities/${act.id}`);

  return (
    <div>
      <AuthorRow item={item} />

      <div
        role="button"
        tabIndex={0}
        onClick={openDetail}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDetail();
          }
        }}
        aria-label={t('viewDetails')}
        className="mt-3 -mx-2 px-2 py-1 rounded-xl cursor-pointer transition-colors hover:bg-page/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
      >
        <PlanVerdictChip act={act} />
        <ActivityStatTiles act={act} />
        <ActivityChips act={act} />
      </div>

      {item.body && (
        <p className="text-sm text-ink-500 mb-2 leading-relaxed"><FeedBodyText body={item.body} /></p>
      )}

      <ActionRow
        item={item}
        commentCount={item.commentCount}
        myAthleteId={myAthleteId}
        isStaff={isStaff}
        onCommentPress={() => onComment(item)}
        onDelete={onDelete ? () => onDelete(item) : undefined}
      />
    </div>
  );
}

export function GroupRunCard({
  group,
  myAthleteId,
  isStaff,
  onComment,
  onDelete,
}: {
  group: RunGroup;
  myAthleteId: string | null;
  isStaff: boolean;
  onComment: (item: FeedItem) => void;
  onDelete?: (item: FeedItem) => void;
}) {
  const t = useTranslations('feed');
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);

  const map = group.mapItem.activity!;
  const anchor = group.items[0];
  const names = group.items.map((item) => item.author.name.split(' ')[0]).filter(Boolean);
  const extra = group.items.length - 2;

  // "עופר ואסף רצו יחד" for a pair, "עופר, אסף ועוד 4 רצו יחד" beyond that. The
  // viewer's own run sorts first (see RunGroup.items), so their own name leads.
  const title =
    group.items.length === 2
      ? t('groupRunPair', { first: names[0] ?? '', second: names[1] ?? '' })
      : t('groupRunMany', { first: names[0] ?? '', second: names[1] ?? '', count: extra });

  // Longest run in the group. Not a sum: eight people running 10 km together did
  // not cover 80 km, and the pooled figure is the one that reads as a lie.
  const longestKm = Math.max(...group.items.map((i) => i.activity!.distance)) / 1000;
  const when = formatActivityTime(anchor.activity!.startTime);
  const place = group.items.find((i) => i.activity!.locationName)?.activity!.locationName;

  const expanded = showAll ? group.items : group.items.slice(0, EXPANDED_COUNT);
  const collapsed = showAll ? [] : group.items.slice(EXPANDED_COUNT);

  return (
    <div className="bg-card rounded-card border border-page overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <AvatarStack items={group.items} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink-700 leading-tight">{title}</p>
            <p className="text-xs text-ink-400 leading-tight mt-0.5">
              {when}
              {place ? ` · ${place}` : ''}
            </p>
          </div>
          <div className="w-7 h-7 rounded-full bg-brand-600/10 flex items-center justify-center shrink-0 mt-0.5">
            <Users className="h-3.5 w-3.5 text-brand-600" />
          </div>
        </div>

        {/* The shared map is the card's anchor, so it gets roughly twice the height
            of a solo card's thumbnail. It draws the longest route in the group —
            the only pick that never crops part of what happened. */}
        <div className="mt-3">
          <RouteMinimap
            points={map.routePreview!}
            paces={map.paceBands}
            width={392}
            height={208}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {t('groupRunRunners', { count: group.items.length })}
          </span>
          {/* Doubles as the explanation for why these runs merged at all. */}
          <span className="rounded-pill bg-brand-600/10 px-2 py-[2px] font-semibold text-brand-600">
            {t('groupRunShared', { pct: group.overlapPct })}
          </span>
          <span className="tabular-nums">
            {t('groupRunLongest', { km: longestKm.toFixed(1) })}
          </span>
          <span className="tabular-nums">
            {formatDuration(map.duration)}
          </span>
        </div>

        <div className="mt-3 space-y-3 border-s-2 border-page ps-3">
          {expanded.map((item) => (
            <ExpandedRunner
              key={item.id}
              item={item}
              myAthleteId={myAthleteId}
              isStaff={isStaff}
              onComment={onComment}
              onDelete={onDelete}
            />
          ))}

          {collapsed.length > 0 && (
            <div className="divide-y divide-page">
              {collapsed.map((item) => (
                <CompactRunner
                  key={item.id}
                  item={item}
                  onOpen={() => router.push(`/dashboard/activities/${item.activity!.id}`)}
                />
              ))}
            </div>
          )}
        </div>

        {collapsed.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-pill border border-brand-600/30 py-2 text-13 font-bold text-brand-600"
          >
            {t('groupRunShowAll', { count: collapsed.length })}
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
