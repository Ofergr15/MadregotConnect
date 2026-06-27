'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function GarminCallbackPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const ticket = searchParams.get('ticket');
    if (ticket && window.opener) {
      window.opener.postMessage({ type: 'garmin-ticket', ticket }, '*');
      window.close();
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
        <p className="text-white font-medium">Connecting to Garmin...</p>
        <p className="text-slate-400 text-sm mt-2">This window will close automatically</p>
      </div>
    </div>
  );
}
