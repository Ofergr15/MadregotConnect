/**
 * The admin's ניהול rows that each hold several places (2026-10-20): one row on the
 * Management page, one short list behind it (/dashboard/manage/[group]) — two levels
 * at most. Every href is an existing screen; nothing here is a copy of one.
 */
export interface ManageItem { label: string; sub?: string; href: string; also?: string }
export interface ManageGroup { key: 'club' | 'notify' | 'access'; title: string; items: ManageItem[] }

export const MANAGE_GROUPS: ManageGroup[] = [
  {
    key: 'club', title: 'המועדון',
    items: [
      { label: 'תגים', sub: 'מה פותח כל תג', href: '/dashboard/settings?tab=badges' },
      { label: 'אתגרים', sub: 'האתגר החודשי', href: '/dashboard/settings?tab=challenges' },
      { label: 'חנות', sub: 'מוצרים, מידות ומלאי', href: '/dashboard/settings?tab=store' },
      { label: 'הטבות', sub: 'השותפים והקודים', href: '/dashboard/settings?tab=perks' },
    ],
  },
  {
    key: 'notify', title: 'התראות ותזכורות',
    items: [
      { label: 'בריאות ההתראות', sub: 'מה באמת הוצג בטלפונים', href: '/dashboard/push-health', also: 'התראות הגיעו הוצגו' },
      { label: 'התראות', sub: 'מה נשלח לחברים', href: '/dashboard/settings?tab=notifications' },
      { label: 'תזכורות', sub: 'לפני אימון ובערב', href: '/dashboard/settings?tab=reminders' },
    ],
  },
  {
    key: 'access', title: 'הרשאות ותחזוקה',
    items: [
      { label: 'הרשאות', sub: 'מי רואה ומפרסם מה, עמודים והתראות ניהול', href: '/dashboard/access', also: 'הרשאות תוכן מפרסם עמודים טאבים התראות ניהול ניתוב' },
      { label: 'תפקידים', sub: 'מאמנים, מנהלים, גרעין', href: '/dashboard/roles' },
      { label: 'מצב תחזוקה', sub: 'מי נכנס בזמן תחזוקה', href: '/dashboard/athletes', also: 'תחזוקה' },
      { label: 'כל ההגדרות', sub: 'כל השאר', href: '/dashboard/settings' },
    ],
  },
];
