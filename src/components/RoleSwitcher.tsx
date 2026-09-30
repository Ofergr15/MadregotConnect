'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { Check, ChevronDown, ClipboardList, Footprints, GraduationCap, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import {
  clearStoredView,
  defaultViewFor,
  getStoredView,
  resolveView,
  ROLE_VIEW_CHIP,
  ROLE_VIEW_SPECS,
  switchView,
  viewsFor,
  VIEW_TOAST_KEY,
  type RoleView,
} from '@/lib/role-views';

// The chip in the middle of the top bar, for an account that holds more than one
// role: which view it is in, and a tap away from the others. See
// src/lib/role-views.ts for what a view is and why it is not the super user's
// "view as". Draws nothing for a plain runner.

export const VIEW_ICON: Record<RoleView, ComponentType<{ className?: string }>> = {
  runner: Footprints,
  coach: ClipboardList,
  manager: GraduationCap,
  admin: Shield,
};

/** The chip's look per view — the mockup's three states; admin shares the manager's solid blue. */
export function ViewChipFace({ view, small = false }: { view: RoleView; small?: boolean }) {
  const Icon = VIEW_ICON[view];
  const solid = view === 'manager' || view === 'admin';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill font-bold whitespace-nowrap',
        small ? 'h-[30px] gap-1.5 ps-1 pe-2.5 text-xs' : 'h-10 gap-[7px] ps-1.5 pe-3 text-sm',
        view === 'runner' && 'bg-card text-ink-700 shadow-[0_1px_2px_rgba(0,0,0,.06)]',
        view === 'coach' && 'bg-[#FFF1E0] text-[#A34A00] shadow-[inset_0_0_0_1.5px_#FFD9A8]',
        solid && 'bg-brand-600 text-white',
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-full',
          small ? 'h-[22px] w-[22px]' : 'h-7 w-7',
          view === 'runner' && 'bg-[#E6F4EC] text-[#0F7A3A]',
          view === 'coach' && 'bg-white text-[#A34A00]',
          solid && 'bg-white/20 text-white',
        )}
      >
        <Icon className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </span>
      {ROLE_VIEW_CHIP[view]}
      <ChevronDown className={cn(small ? 'h-3 w-3' : 'h-3.5 w-3.5', view === 'runner' ? 'text-ink-300' : solid ? 'text-white/75' : 'text-[#A34A00]')} />
    </span>
  );
}

export function RoleSwitcher({
  roles,
  role,
  isSuper,
  className,
  showToast = true,
}: {
  /** From /api/auth/me. Undefined until it answers, and the chip waits for it. */
  roles: string[] | undefined;
  role: string | null;
  isSuper: boolean;
  /** On the chip's button only — the sheet and the toast are not inside it. */
  className?: string;
  /** The header mounts two chips (phone and desktop); only one may own the toast. */
  showToast?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState<RoleView | null>(null);
  const [toast, setToast] = useState<RoleView | null>(null);

  useEffect(() => {
    setStored(getStoredView());
    // Set by switchView just before the navigation, so it shows once, on the
    // screen the switch landed on.
    if (!showToast) return;
    const t = sessionStorage.getItem(VIEW_TOAST_KEY);
    if (t === 'runner' || t === 'coach' || t === 'manager' || t === 'admin') {
      sessionStorage.removeItem(VIEW_TOAST_KEY);
      setToast(t);
      const id = setTimeout(() => setToast(null), 2600);
      return () => clearTimeout(id);
    }
  }, []);

  const views = roles ? viewsFor(roles, isSuper) : [];
  // A choice the account no longer holds (a role taken away) is dropped here, so
  // the key cannot keep asking for a view the server will not back.
  useEffect(() => {
    if (roles && stored && !views.includes(stored)) { clearStoredView(); setStored(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, stored, isSuper]);

  const toastEl = toast && (
    <div
      role="status"
      className="fixed inset-x-0 z-[60] flex justify-center pointer-events-none bottom-[calc(env(safe-area-inset-bottom)+96px)]"
    >
      <span className="flex items-center gap-2 rounded-pill bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
        <Check className="h-4 w-4" />
        עברת לתצוגת {ROLE_VIEW_SPECS[toast].label}
      </span>
    </div>
  );

  if (views.length < 2) return toastEl || null;
  const current = resolveView(stored, views, defaultViewFor(role, isSuper));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`תצוגה: ${ROLE_VIEW_SPECS[current].label}. החלפת תצוגה`}
        className={cn('active:scale-95 transition-transform', className)}
      >
        <ViewChipFace view={current} />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="לאיזו תצוגה לעבור?">
        <p className="-mt-1 pb-3 text-center text-xs text-ink-400">אפשר לחזור בכל רגע מהתווית שבראש המסך</p>
        <div className="space-y-2 pb-2" dir="rtl">
          {views.map(v => {
            const Icon = VIEW_ICON[v];
            const on = v === current;
            return (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!on) switchView(v, roles || [], role);
                }}
                className={cn(
                  'flex w-full min-h-[60px] items-center gap-3 rounded-2xl px-3 py-2.5 text-start transition-colors',
                  on ? 'bg-brand-600/[.07] shadow-[inset_0_0_0_1.5px_#1525FF]' : 'bg-page/60 active:bg-page',
                )}
              >
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                    v === 'runner' && 'bg-[#E6F4EC] text-[#0F7A3A]',
                    v === 'coach' && 'bg-[#FFF1E0] text-[#A34A00]',
                    (v === 'manager' || v === 'admin') && 'bg-brand-600 text-white',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-ink-700">{ROLE_VIEW_SPECS[v].label}</span>
                  <span className="block text-xs text-ink-400">{ROLE_VIEW_SPECS[v].description}</span>
                </span>
                {on && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                    <Check className="h-4 w-4" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Sheet>
      {toastEl}
    </>
  );
}
