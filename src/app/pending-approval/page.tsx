'use client';

import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { Card, EmptyState, Button } from '@/components/ui';
import { ApprovalPushOptIn } from '@/components/PushOptIn';

export default function PendingApprovalPage() {
  const t = useTranslations('onboarding');

  const handleBackHome = async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
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
      </Card>
      <ApprovalPushOptIn />
    </div>
  );
}
