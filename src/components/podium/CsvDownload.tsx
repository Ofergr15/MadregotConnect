'use client';

import { useState, type ReactNode } from 'react';
import { apiHeaders } from '@/lib/api';

/**
 * A download button for /api/admin/podium/csv.
 *
 * It used to be a plain `<a href>`, but the route checks the Supabase JWT in the
 * Authorization header (requireStaffCaller) and a browser navigation never sends
 * one — so every click got a 401 JSON page instead of the file. So: fetch with
 * the bearer, then hand the blob to the browser under the server's filename.
 */
export function CsvDownload({ url, className, children }: { url: string; className?: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(url, { headers: await apiHeaders() });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(j.message || `שגיאה ${r.status}`);
      }
      const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'podium.csv';
      const href = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = href; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ההורדה נכשלה');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void go()} className={className}>{busy ? '…' : children}</button>
      {err && <p className="mt-1 text-center text-2xs font-bold text-red-600">{err}</p>}
    </>
  );
}
