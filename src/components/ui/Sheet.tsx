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
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
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
          {/* grabber handle */}
          <div className="mx-auto mt-2.5 mb-1 h-1.5 w-10 rounded-full bg-slate-600" />
          {title && (
            <Drawer.Title className="px-5 pt-2 pb-1 text-base font-bold text-white text-center">
              {title}
            </Drawer.Title>
          )}
          <div className="overflow-y-auto px-4 pb-4 pt-2">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
