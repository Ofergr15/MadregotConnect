'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { Card, EmptyState, Button } from '@/components/ui';
import { PushOptIn, requestPushOptInPrompt } from '@/components/PushOptIn';

export default function PendingApprovalPage() {
  const t = useTranslations('onboarding');
  const tp = useTranslations('push');

  // The exact moment push notifications become concretely useful here: the
  // one thing this athlete is waiting for is a coach approving them, and
  // there's otherwise no way to know it happened short of guessing and
  // signing back in.
  useEffect(() => { requestPushOptInPrompt(); }, []);

  const handleBackHome = async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <Card className="max-w-md text-center">
        <div className="flex items-center justify-center">
          <img src="/images/logo.png" alt="Madregot" className="h-10 w-10 object-contain brightness-0 invert" />
          <span className="text-lg font-bold text-white ms-3">Madregot</span>
        </div>

        <EmptyState
          icon={Clock}
          title={t('waitingApproval')}
          description={t('approvalMessage')}
          action={<Button variant="secondary" onClick={handleBackHome}>{t('backHome')}</Button>}
          className="mx-auto"
        />
      </Card>
      <PushOptIn title={tp('approvalTitle')} description={tp('approvalDescription')} />
    </div>
  );
}
