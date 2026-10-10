'use client';

import { OnboardingFunnel } from '@/components/admin/OnboardingFunnel';

/** /dashboard/onboarding-funnel — the joining funnel. The API is gated to the super user and approvers. */
export default function OnboardingFunnelPage() {
  return <OnboardingFunnel />;
}
