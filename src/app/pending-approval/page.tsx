'use client';

import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { signOutEverywhere } from '@/lib/auth/sign-out';
import { Card, EmptyState, Button } from '@/components/ui';
import { ApprovalPushOptIn } from '@/components/PushOptIn';
import ClaimExistingAccount from '@/components/ClaimExistingAccount';

export default function PendingApprovalPage() {
  const t = useTranslations('onboarding');

  const handleBackHome = async () => {
    await signOutEverywhere();
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <Card className="max-w-md text-center">
        <div className="flex items-center justify-center">
          <img src="/images/logo.png" alt="Madregot" className="h-10 w-10 object-contain brightness-0 invert" />
          <span className="text-lg font-bold text-ink-700 ms-3">Madregot</span>
        </div>

        <EmptyState
          icon={Clock}
          titleAs="h1"
          title={t('waitingApproval')}
          description={t('approvalMessage')}
          action={<Button variant="secondary" onClick={handleBackHome}>{t('backHome')}</Button>}
          className="mx-auto"
        />

        {/* Under the "waiting for approval" message, because for some of the people
            reading it that message is simply wrong: they are already members, and
            the only reason they are here is that their Strava name could not be
            matched to their roster row. This is their way back to their own
            account without anybody's help. */}
        <ClaimExistingAccount />
      </Card>
      <ApprovalPushOptIn />
    </div>
  );
}
