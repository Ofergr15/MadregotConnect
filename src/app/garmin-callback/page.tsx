'use client';

import { useEffect, useState } from 'react';

export default function GarminCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticket = params.get('ticket');

    if (!ticket) {
      setStatus('error');
      return;
    }

    if (window.opener) {
      window.opener.postMessage({ type: 'garmin-ticket', ticket }, '*');
      setStatus('done');
      setTimeout(() => window.close(), 1000);
    } else {
      // Mobile or popup blocked — store ticket and redirect to join page
      localStorage.setItem('garmin_ticket', ticket);
      setStatus('done');
      window.location.href = '/';
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="text-center">
        {status === 'error' ? (
          <>
            <p className="text-red-400 font-medium">No ticket received from Garmin</p>
            <p className="text-slate-400 text-sm mt-2">Please try again</p>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
            <p className="text-white font-medium">Connecting to Garmin...</p>
            <p className="text-slate-400 text-sm mt-2">This window will close automatically</p>
          </>
        )}
      </div>
    </div>
  );
}
