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

// The view switch for an account that holds more than one role: which view it is
// in, and a tap away from the others. See src/lib/role-views.ts for what a view is
// and why it is not the super user's "view as". Draws nothing for a plain runner.
//
// Two homes. On a wide screen it is a chip in the user cluster (RoleSwitcher). On a
// phone it lives in the account menu (ViewMenuRow) with a small mark on the avatar
// (ViewBadge): the header row there is full, and a chip pinned to its centre sat on
// top of the bell and the search button.

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

/** The views this account holds and the one it is in; `views` is empty until /api/auth/me answers. */
export function useRoleViews(roles: string[] | undefined, role: string | null, isSuper: boolean) {
  const [stored, setStored] = useState<RoleView | null>(null);
  useEffect(() => { setStored(getStoredView()); }, []);

  const views = roles ? viewsFor(roles, isSuper) : [];
  // A choice the account no longer holds (a role taken away) is dropped here, so
  // the key cannot keep asking for a view the server will not back.
  useEffect(() => {
    if (roles && stored && !views.includes(stored)) { clearStoredView(); setStored(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, stored, isSuper]);

  return { views, current: resolveView(stored, views, defaultViewFor(role, isSuper)) };
}

/** "עברת לתצוגת…", once, on the screen a switch landed on. Mount it once per page. */
export function ViewSwitchToast() {
  const [toast, setToast] = useState<RoleView | null>(null);
  useEffect(() => {
    // Set by switchView just before the navigation.
    const t = sessionStorage.getItem(VIEW_TOAST_KEY);
    if (t === 'runner' || t === 'coach' || t === 'manager' || t === 'admin') {
      sessionStorage.removeItem(VIEW_TOAST_KEY);
      setToast(t);
      const id = setTimeout(() => setToast(null), 2600);
      return () => clearTimeout(id);
    }
  }, []);
  if (!toast) return null;
  return (
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
}

const VIEW_TINT: Record<RoleView, string> = {
  runner: 'text-[#0F7A3A]',
  coach: 'text-[#A34A00]',
  manager: 'text-brand-600',
  admin: 'text-brand-600',
};

/** The current view's icon on the corner of the phone avatar. */
export function ViewBadge({ view }: { view: RoleView }) {
  const Icon = VIEW_ICON[view];
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -bottom-[3px] -start-[3px] flex h-5 w-5 items-center justify-center rounded-full bg-white ring-2 ring-page',
        VIEW_TINT[view],
      )}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

/** "התצוגה שלי" at the top of the phone account menu: one segment per view. */
export function ViewMenuRow({
  views,
  current,
  roles,
  role,
  onPicked,
}: {
  views: RoleView[];
  current: RoleView;
  roles: string[] | undefined;
  role: string | null;
  onPicked?: () => void;
}) {
  if (views.length < 2) return null;
  return (
    <div className="mb-4">
      <div className="mb-2 px-1 text-2xs font-bold uppercase tracking-wider text-ink-400">התצוגה שלי</div>
      <div
        role="radiogroup"
        aria-label="התצוגה שלי"
        className="grid gap-1.5 rounded-2xl bg-card p-1"
        style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }}
      >
        {views.map(v => {
          const Icon = VIEW_ICON[v];
          const on = v === current;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={ROLE_VIEW_SPECS[v].label}
              onClick={() => {
                onPicked?.();
                if (!on) switchView(v, roles || [], role);
              }}
              className={cn(
                'flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-1 text-sm font-bold transition-colors',
                on ? 'bg-brand-600 text-white' : 'text-ink-500 active:bg-page',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{ROLE_VIEW_CHIP[v]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The wide-screen chip, and the sheet of views it opens. */
export function RoleSwitcher({
  roles,
  role,
  isSuper,
  className,
}: {
  /** From /api/auth/me. Undefined until it answers, and the chip waits for it. */
  roles: string[] | undefined;
  role: string | null;
  isSuper: boolean;
  /** On the chip's button only — the sheet is not inside it. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { views, current } = useRoleViews(roles, role, isSuper);

  if (views.length < 2) return null;

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
    </>
  );
}
