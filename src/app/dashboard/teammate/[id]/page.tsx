'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { AlertCircle, UserCheck, UserPlus, Users } from 'lucide-react';
import { useApi } from '@/lib/api';
import { Button, Card, EmptyState, LoadingBlock, BigStat, Skeleton, BackNav } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';

// Peer-facing "teammate" profile — any club member can view any other
// member's profile here. Deliberately a NEW route, distinct from the
// coach-only admin roster at dashboard/athletes/page.tsx: this page reads
// GET /api/athletes/[id]/public (privacy-safe projection — no email/
// onboarding-status/garmin-auth) for identity, and GET
// /api/athletes/[id]/connections for follower/following counts + the
// viewer's own follow state.

interface PublicProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  groupId: string | null;
  groupName: string | null;
  memberSince: string | null;
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
        headers: { 'Content-Type': 'application/json' },
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

      {/* Hero — same gradient-card recipe as dashboard/profile/page.tsx,
          minus the owner-only bits (email, data-source badges, photo upload —
          none of those are safe/relevant on a peer's profile). */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600/15 via-slate-800/90 to-slate-800 border border-slate-700/50 p-6">
        <div className="absolute top-0 end-0 w-32 h-32 bg-primary-600/8 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
        <div className="relative flex items-center gap-4">
          <FeedAvatar name={profile.name} url={profile.avatarUrl} className="w-16 h-16" textClassName="text-xl" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{profile.name}</h1>
            {profile.memberSince && (
              <p className="text-xs text-slate-500 mt-1">
                {tProfile('memberSince')}{' '}
                {new Date(profile.memberSince).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
              </p>
            )}
            {profile.groupName && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <Users className="h-3.5 w-3.5 text-primary-600 shrink-0" />
                <span className="text-sm font-medium text-primary-600">{profile.groupName}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-around">
          {showConnectionsSkeleton ? (
            <>
              <Skeleton className="h-12 w-16" />
              <Skeleton className="h-12 w-16" />
            </>
          ) : (
            <>
              <BigStat value={connections?.followerCount ?? 0} label={t('followers')} />
              <div className="w-px h-10 bg-slate-700/50" />
              <BigStat value={connections?.followingCount ?? 0} label={t('following')} />
            </>
          )}
        </div>
      </Card>

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
    </div>
  );
}
