'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { AlertCircle, Star, UserCheck, UserPlus, Users } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { Button, EmptyState, LoadingBlock, Skeleton, BackNav } from '@/components/ui';
import { cn } from '@/lib/utils';
import { FeedAvatar } from '@/components/FeedAvatar';
import CoreRunnerBadge from '@/components/CoreRunnerBadge';
import { AthleteProfileBody } from '@/components/profile/AthleteProfileBody';

// Peer-facing "teammate" profile — any club member can view any other member's
// profile here. Deliberately a NEW route, distinct from the coach-only admin
// roster at dashboard/athletes/page.tsx.
//
// This page is now the hero only: back-nav, avatar, name, group, and the follow
// toggle. Everything below it — the stat trio, the דבוקה card, the runs list, the
// weekly km table, the ten-week chart and the PRs — is AthleteProfileBody, the
// SAME component the owner's own profile renders. That is what "unify the two
// profiles" means in practice: one implementation, two heroes, and no way for
// the peer view to quietly fall behind again. It used to be this page's whole
// content: a name, a group and two follower counts, with no runs, no band and no
// kilometres anywhere — a dead end from every feed card that linked here.
//
// Reads GET /api/athletes/[id]/public for identity and
// GET /api/athletes/[id]/connections for the counts + the viewer's follow state;
// the body shares both of those SWR keys, so adding it cost no extra request.

interface PublicProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  groupId: string | null;
  groupName: string | null;
  memberSince: string | null;
  isCoreRunner: boolean;
  isAcademy: boolean;
}

interface ConnectionsSummary {
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  followers: Array<{ id: string; name: string; avatarUrl: string | null }>;
  following: Array<{ id: string; name: string; avatarUrl: string | null }>;
}

export default function TeammateProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('teammate');
  const tProfile = useTranslations('profile');
  const tc = useTranslations('common');

  // The viewer's own athlete id, same localStorage convention used across the
  // app (see dashboard/profile/page.tsx). `viewerLoaded` distinguishes "not
  // read yet" from "read, and there genuinely is none", so the connections
  // fetch doesn't fire once with a missing viewerId and again a moment later.
  const [viewerId, setViewerId] = useState('');
  const [viewerLoaded, setViewerLoaded] = useState(false);
  useEffect(() => {
    setViewerId(localStorage.getItem('athlete_id') || '');
    setViewerLoaded(true);
  }, []);

  const { data: profile, error: profileError, isLoading: profileLoading } = useApi<PublicProfile>(
    id ? `/api/athletes/${id}/public` : null,
  );

  const connectionsKey =
    id && viewerLoaded
      ? `/api/athletes/${id}/connections${viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : ''}`
      : null;
  const {
    data: connections,
    isLoading: connectionsLoading,
    mutate: mutateConnections,
  } = useApi<ConnectionsSummary>(connectionsKey);

  // The viewer's own favourites list (ff8d932e). Ids only, and the route takes
  // the owner from the session — see /api/athletes/favorites. Deliberately NOT
  // folded into the connections request: a favourite is private, and the
  // connections payload is about this athlete's public social graph.
  const { data: favorites, mutate: mutateFavorites } = useApi<{ athleteIds: string[] }>(
    viewerLoaded && viewerId ? '/api/athletes/favorites' : null,
  );
  const isFavorite = !!favorites?.athleteIds?.includes(id);
  const [favoritePending, setFavoritePending] = useState(false);

  async function handleFavoriteToggle() {
    if (!id || !favorites || favoritePending) return;
    setFavoritePending(true);
    const next = !isFavorite;
    try {
      const res = await fetch(
        next ? '/api/athletes/favorites' : `/api/athletes/favorites?athleteId=${encodeURIComponent(id)}`,
        {
          method: next ? 'POST' : 'DELETE',
          headers: await apiHeaders(true),
          body: next ? JSON.stringify({ athleteId: id }) : undefined,
        },
      );
      // A failed call leaves the list exactly as the server has it — the star
      // is only patched on success, so it can never claim a favourite that
      // isn't stored (which would then quietly not show up in the feed filter).
      if (res.ok) {
        mutateFavorites(
          prev => {
            const ids = prev?.athleteIds || [];
            return { athleteIds: next ? [...ids, id] : ids.filter(x => x !== id) };
          },
          { revalidate: false },
        );
      }
    } catch {
      /* network error — nothing was changed locally, so nothing to roll back */
    } finally {
      setFavoritePending(false);
    }
  }

  const [followPending, setFollowPending] = useState(false);
  // Viewing your own profile via this route (e.g. from a shared link) — no
  // self-follow concept (blocked by the athlete_follows CHECK constraint
  // anyway), so the toggle is hidden entirely rather than shown disabled.
  const isOwnProfile = viewerLoaded && !!viewerId && viewerId === id;

  async function handleFollowToggle() {
    if (!viewerId || !id || !connections || followPending) return;
    setFollowPending(true);
    try {
      const res = await fetch('/api/athletes/follow', {
        method: connections.isFollowing ? 'DELETE' : 'POST',
        // Both directions check that the caller IS followerId, from the
        // verified session — hence the bearer token, not just a content type.
        headers: await apiHeaders(true),
        body: JSON.stringify({ followerId: viewerId, followeeId: id }),
      });
      if (res.ok) {
        const body: { following: boolean } = await res.json();
        // Optimistic local patch (no revalidate) — this athlete's own
        // follower count changed by exactly one; a background revalidate on
        // next focus will reconcile with the server if anything else changed
        // followerCount in the meantime.
        mutateConnections(
          (prev) =>
            prev
              ? {
                  ...prev,
                  isFollowing: body.following,
                  followerCount: Math.max(0, prev.followerCount + (body.following ? 1 : -1)),
                }
              : prev,
          { revalidate: false },
        );
      }
    } catch {
      // Network error — nothing was optimistically changed yet, so there's
      // nothing to roll back; the button simply stays in its prior state.
    } finally {
      setFollowPending(false);
    }
  }

  if (profileLoading) return <LoadingBlock className="min-h-[60vh]" />;

  if (profileError || !profile) {
    return (
      <div className="max-w-lg mx-auto px-4 py-10">
        <EmptyState
          icon={AlertCircle}
          title={t('notFound')}
          description={t('notFoundHint')}
          action={
            <Button variant="secondary" onClick={() => router.back()}>
              {tc('back')}
            </Button>
          }
        />
      </div>
    );
  }

  const showConnectionsSkeleton = connectionsLoading && !connections;

  return (
    <div className="max-w-lg mx-auto space-y-5 pb-8">
      <BackNav label={tc('back')} onBack={() => router.back()} />

      {/* ═══ HERO ═══ Avatar, name, group, join date — the owner-only bits (email,
          data-source badges, photo upload) have no place on a peer's profile. */}
      <div className="flex items-center gap-4">
        {/* Enlargeable here and not in the feed: this header is the one place the
            photo is the subject rather than a label beside a name, and the tap is
            free — everywhere else it means "open this person's profile", which is
            where you already are. */}
        <FeedAvatar
          name={profile.name}
          url={profile.avatarUrl}
          className="w-16 h-16"
          textClassName="text-xl"
          enlargeable
        />
        <div className="flex-1 min-w-0">
          {/* The 🌰 sits NEXT to the name, outside its truncate, so a long name
              can't eat the mark — same rule as the owner's own header. */}
          <div className="flex items-baseline gap-1.5">
            <h1 className="truncate text-xl font-bold text-ink-700" dir="auto">{profile.name}</h1>
            {profile.isCoreRunner && <CoreRunnerBadge className="text-base" />}
          </div>
          {profile.groupName && (
            <div className="flex items-center gap-1.5 mt-1">
              <Users className="h-3.5 w-3.5 text-brand-600 shrink-0" />
              <span className="text-sm font-bold text-brand-600">{profile.groupName}</span>
            </div>
          )}
          {profile.memberSince && (
            <p className="text-xs font-light text-ink-400 mt-1">
              {tProfile('memberSince')}{' '}
              {new Date(profile.memberSince).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
      </div>

      {/* Follow/Following toggle and the favourite star — both hidden entirely on
          your own profile. They sit on one line because they are the two things
          you can do ABOUT this person, but they are two separate actions and not
          one: a follow is public and drives their notifications, a favourite is
          private and only changes what the viewer's own feed shows. */}
      {!isOwnProfile && viewerLoaded && viewerId && (
        showConnectionsSkeleton ? (
          <Skeleton className="h-11 w-full rounded-xl" />
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant={connections?.isFollowing ? 'secondary' : 'primary'}
              className="flex-1"
              disabled={followPending}
              onClick={handleFollowToggle}
            >
              {connections?.isFollowing ? (
                <>
                  <UserCheck className="h-4 w-4" />
                  {t('followingButton')}
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  {t('follow')}
                </>
              )}
            </Button>
            {/* Icon-only: the label would have to say "add to my private
                favourites" to be honest, which is a paragraph next to a
                one-word button. The accessible name carries it instead. */}
            <button
              type="button"
              onClick={handleFavoriteToggle}
              disabled={favoritePending || !favorites}
              aria-pressed={isFavorite}
              aria-label={isFavorite ? t('favoriteRemove') : t('favoriteAdd')}
              title={isFavorite ? t('favoriteRemove') : t('favoriteAdd')}
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-50',
                // The filled state uses the brand indigo rather than a star's
                // conventional gold: the palette has no amber that clears AA on
                // its own wash (see tailwind.config.ts), and inventing one for a
                // single button is how a second accent colour gets into an app.
                isFavorite
                  ? 'border-brand-600/40 bg-brand-600/10 text-brand-600'
                  : 'border-page bg-card text-ink-400 hover:text-ink-500',
              )}
            >
              <Star className={cn('h-5 w-5', isFavorite && 'fill-current')} />
            </button>
          </div>
        )
      )}

      <AthleteProfileBody athleteId={id} viewerId={viewerId} variant="peer" />
    </div>
  );
}
