'use client';

import { forwardRef, useEffect, useRef, useState, type ComponentType, type InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

// ═════════════════════════════════════════════════════════════════════════════
// The one password field in the app, with a show/hide eye.
//
// - It only flips `type` on what the person has typed in THIS field. It never
//   receives or shows a stored password: there is no prop for one.
// - It goes back to hidden when focus leaves the field (unless focus moved to
//   its own eye button) and when the enclosing form submits, so a revealed
//   password is never left on screen after the moment it was checked.
// - autoComplete / name / id pass straight through to the <input>, so password
//   managers keep recognising the field.
// - The eye sits at the inline END (left in Hebrew RTL, right in English) via
//   logical `end-*` / `pe-*`, with a 44px tap target.
// ═════════════════════════════════════════════════════════════════════════════

export type RevealEvent = 'toggle' | 'blur' | 'submit';

/** Pure state step, so the rule is testable without a DOM. */
export function revealStep(visible: boolean, event: RevealEvent): boolean {
  return event === 'toggle' ? !visible : false;
}

type InputLike = ComponentType<InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }>;

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** The page's own input component, so its styling is kept. Defaults to a plain <input>. */
  as?: InputLike | 'input';
  /** Extra classes on the wrapper. */
  wrapperClassName?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { as = 'input', className, wrapperClassName, onBlur, ...rest },
  forwardedRef,
) {
  const t = useTranslations('common');
  const [visible, setVisible] = useState(false);
  const inner = useRef<HTMLInputElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  // Hide again on submit of the enclosing form.
  useEffect(() => {
    const form = inner.current?.form;
    if (!form) return;
    const hide = () => setVisible((v) => revealStep(v, 'submit'));
    form.addEventListener('submit', hide);
    return () => form.removeEventListener('submit', hide);
  }, []);

  const setRef = (el: HTMLInputElement | null) => {
    inner.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  const leaving = (next: EventTarget | null) => next !== button.current && next !== inner.current;

  const Field = as as InputLike;
  return (
    <div className={cn('relative', wrapperClassName)}>
      <Field
        {...rest}
        ref={setRef}
        type={visible ? 'text' : 'password'}
        className={cn(className, 'pe-12')}
        onBlur={(e) => {
          if (leaving(e.relatedTarget)) setVisible((v) => revealStep(v, 'blur'));
          onBlur?.(e);
        }}
      />
      <button
        ref={button}
        type="button"
        aria-label={visible ? t('hidePassword') : t('showPassword')}
        aria-pressed={visible}
        aria-controls={rest.id}
        // Keep focus (and the iOS keyboard) in the field when tapped.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => revealStep(v, 'toggle'))}
        onBlur={(e) => { if (leaving(e.relatedTarget)) setVisible((v) => revealStep(v, 'blur')); }}
        className="absolute end-0 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center text-ink-400 transition-colors hover:text-ink-700"
      >
        {visible ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
});
