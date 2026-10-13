'use client';

import { useEffect, useState } from 'react';
import { useIsSuperUser } from '@/lib/impersonation';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { useApi } from '@/lib/api';

/**
 * /dashboard/data-check — the trainee data-coverage table as a page, so it is
 * opened rather than run from the console. The super user and admins; the route itself
 * (api/admin/trainee-data-coverage) owns the admin gate and the view-as refusal.
 */
export default function DataCheckPage() {
  // The route admits the super user AND admins (launch N29): the page used to be blank for
  // an admin who is not the super user.
  const superUser = useIsSuperUser();
  const { data: me } = useApi<{ role?: string; roles?: string[] }>(superUser ? null : '/api/auth/me');
  const isSuper = superUser || me?.role === 'admin' || !!me?.roles?.includes('admin');
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuper) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/trainee-data-coverage?format=text', { headers: await bearerHeaders(false), cache: 'no-store' });
        const body = await res.text();
        if (!live) return;
        if (res.ok) setText(body);
        else setFailed(`${res.status} ${body.slice(0, 200)}`);
      } catch (e) {
        if (live) setFailed(String(e));
      }
    })();
    return () => { live = false; };
  }, [isSuper]);

  if (!isSuper) return null;
  return (
    <div className="px-4 py-4">
      <h1 className="text-xl font-black">בדיקת נתונים של המתאמנים</h1>
      <p className="mt-1 text-sm text-ink-400">מה יש לכל מתאמן, ומה הוא יראה בכל מסך. ✓ מלא · ≈ הערכה · … לומד · ✗ חסר</p>
      {failed && <p className="mt-4 text-sm font-bold text-red-600" dir="ltr">{failed}</p>}
      {!text && !failed && <p className="mt-4 text-sm text-ink-400">טוען… (עד חצי דקה)</p>}
      {text && (
        <pre dir="rtl" className="mt-4 whitespace-pre-wrap rounded-2xl bg-white p-3 text-[12.5px] leading-relaxed shadow-sm">{text}</pre>
      )}
    </div>
  );
}
