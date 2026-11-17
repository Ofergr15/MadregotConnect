'use client';

import { usePathname } from 'next/navigation';
import { isWidePath } from '@/lib/wide-pages';
import { cn } from '@/lib/utils';

/**
 * A page's outer width wrapper. `className` is exactly what the page used before
 * (its phone/tablet cap, e.g. `max-w-5xl mx-auto`); on a wide route
 * (lib/wide-pages.ts) `wide` is appended — md:-prefixed only, so a phone renders
 * the same classes it always did.
 */
export function WidePage({
  className,
  wide = 'md:max-w-none',
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { wide?: string }) {
  const pathname = usePathname();
  return (
    <div className={cn(className, isWidePath(pathname) && wide)} {...rest}>
      {children}
    </div>
  );
}
