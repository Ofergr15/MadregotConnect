'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { AlertCircle, UserCheck, UserPlus, Users } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { Button, EmptyState, LoadingBlock, Skeleton, BackNav } from '@/components/ui';
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
        <FeedAvatar name={profile.name} url={profile.avatarUrl} className="w-16 h-16" textClassName="text-xl" />
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

      {/* Follow/Following toggle — hidden entirely on your own profile. */}
      {!isOwnProfile && viewerLoaded && viewerId && (
        showConnectionsSkeleton ? (
          <Skeleton className="h-11 w-full rounded-xl" />
        ) : (
          <Button
            variant={connections?.isFollowing ? 'secondary' : 'primary'}
            className="w-full"
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
        )
      )}

      <AthleteProfileBody athleteId={id} viewerId={viewerId} variant="peer" />
    </div>
  );
}
