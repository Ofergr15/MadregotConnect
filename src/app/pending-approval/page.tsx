'use client';

import { Clock } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';

export default function PendingApprovalPage() {
  const handleBackHome = async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8 w-full max-w-md text-center">
        <div className="flex items-center justify-center mb-6">
          <img src="/images/logo.png" alt="Madregot" className="h-10 w-10 object-contain brightness-0 invert" />
          <span className="text-lg font-bold text-white ms-3">Madregot</span>
        </div>

        <div className="bg-amber-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <Clock className="h-8 w-8 text-amber-400" />
        </div>

        <h1 className="text-xl font-bold text-white">Waiting for Approval</h1>
        <p className="text-slate-400 mt-3 text-sm leading-relaxed">
          Your account has been created successfully. An admin will review and approve your access shortly.
        </p>
        <p className="text-slate-500 mt-2 text-xs">
          You&apos;ll receive an email once you&apos;re approved.
        </p>

        <button
          onClick={handleBackHome}
          className="inline-block mt-6 px-6 py-3 text-sm font-medium text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
