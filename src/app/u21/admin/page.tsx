'use client';

import { useApi } from '@/lib/api';
import { DRAFT_NOTE, U21_TRACKS } from '@/lib/u21/intake';

interface Row {
  id: string; first_name: string; last_name: string; age_band: string; track: string;
  red_flag: boolean; status: string; created_at: string;
}

const STATUS: Record<string, string> = {
  pending_review: 'ממתין לבדיקה', reviewed: 'נבדק', accepted: 'התקבל', declined: 'נדחה',
};

// Read-only. Admin-only by the API (GET /api/u21/registrations); anyone else sees the error.
export default function U21AdminPage() {
  const { data, error, isLoading } = useApi<{ data: Row[]; ready: boolean }>('/api/u21/registrations');
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">הרשמות U21</h1>
      <p className="mb-4 text-xs text-amber-800">רשימת הדגלים היא {DRAFT_NOTE}. דגל אינו החלטה — רק סימון לבדיקה.</p>
      {isLoading && <p>טוען…</p>}
      {error && <p className="text-red-700">אין הרשאה או שגיאה בטעינה (נדרשת התחברות כמנהל)</p>}
      {data && !data.ready && <p className="text-amber-700">הטבלה עדיין לא קיימת — יש להריץ את מיגרציה 180.</p>}
      {data?.ready && data.data.length === 0 && <p className="text-gray-600">אין הרשמות עדיין.</p>}
      {!!data?.data.length && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-right">
              <tr>
                <th className="p-2">שם</th><th className="p-2">גיל</th><th className="p-2">מסלול</th>
                <th className="p-2">דורש תשומת לב</th><th className="p-2">סטטוס</th><th className="p-2">נשלח</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.first_name} {r.last_name}</td>
                  <td className="p-2">{r.age_band}</td>
                  <td className="p-2">{U21_TRACKS.find(t => t.id === r.track)?.name ?? r.track}</td>
                  <td className="p-2">{r.red_flag ? <AttentionBadge /> : null}</td>
                  <td className="p-2">{STATUS[r.status] ?? r.status}</td>
                  <td className="p-2" dir="ltr">{new Date(r.created_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Inline SVG, not an emoji: renders the same on every device and in captures. */
function AttentionBadge() {
  return (
    <span data-testid="u21-attention" className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
      <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
        <path d="M3 1.5a.75.75 0 0 1 .75.75V3h8.5a.5.5 0 0 1 .4.8L11 6l1.65 2.2a.5.5 0 0 1-.4.8h-8.5v5.25a.75.75 0 0 1-1.5 0V2.25A.75.75 0 0 1 3 1.5Z" />
      </svg>
      דורש תשומת לב
    </span>
  );
}
