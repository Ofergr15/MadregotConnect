'use client';

import { Drawer } from 'vaul';
import { cn } from '@/lib/utils';

// Native-style bottom sheet (Phase 3) built on vaul: grabber handle, drag/
// swipe-down-to-dismiss, backdrop, and built-in focus trap + Escape + aria-modal
// (fixing the a11y gap where ~20 hand-rolled `fixed inset-0` modals had no dialog
// semantics). Replaces centered web dialogs. RTL-safe (vertical drag only).
//
// Controlled usage:
//   <Sheet open={open} onOpenChange={setOpen} title="…">…</Sheet>
export function Sheet({
  open,
  onOpenChange,
  title,
  leadingAction,
  trailingAction,
  children,
  footer,
  className,
  bodyClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  leadingAction?: React.ReactNode;
  trailingAction?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm" />
        <Drawer.Content
          className={cn(
            'fixed bottom-0 inset-x-0 z-[310] flex flex-col rounded-t-2xl border-t border-slate-700 bg-slate-800 outline-none',
            'max-h-[92vh] pb-[env(safe-area-inset-bottom)]',
            className
          )}
        >
          <div className="mx-auto mt-2.5 mb-1 h-1.5 w-10 rounded-full bg-slate-600" />
          {(leadingAction || trailingAction) ? (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-slate-700/60 px-4 pb-3 pt-1">
              <div className="justify-self-start">{leadingAction}</div>
              {title && (
                <Drawer.Title className="text-base font-bold text-white text-center">
                  {title}
                </Drawer.Title>
              )}
              <div className="justify-self-end">{trailingAction}</div>
            </div>
          ) : title ? (
            <Drawer.Title className="px-5 pt-2 pb-1 text-base font-bold text-white text-center">
              {title}
            </Drawer.Title>
          ) : null}
          <div className={cn('overflow-y-auto px-4 pb-4 pt-2', bodyClassName)}>{children}</div>
          {footer}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
