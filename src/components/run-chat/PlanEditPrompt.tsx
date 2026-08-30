'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2, PencilLine, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  MessageActions,
  defaultMessageActionSet,
  type ContextMenuItemProps,
  useContextMenuContext,
  useMessageContext,
} from 'stream-chat-react';
import { Button } from '@/components/ui/button';
import { AI_USER_ID } from '@/lib/stream/constants';

type OpenPlanEditor = (messageId: string, currentPlan: string) => void;

const PlanEditContext = createContext<OpenPlanEditor | null>(null);

function isPlanSeedMessage(message: {
  user?: { id?: string } | null;
  text?: string;
  [key: string]: unknown;
}) {
  return (
    message.user?.id === AI_USER_ID &&
    (message.run_chat_seed === 'plan' || (message.text || '').includes('תוכנית האימון'))
  );
}

function PlanEditAction(props: ContextMenuItemProps) {
  const t = useTranslations('runChat');
  const openEditor = useContext(PlanEditContext);
  const { closeMenu } = useContextMenuContext();
  const { message } = useMessageContext('PlanEditAction');

  if (!openEditor || !isPlanSeedMessage(message as typeof message & Record<string, unknown>)) {
    return null;
  }

  const currentPlan = (message.text || '').replace(/^📋\s*תוכנית האימון להיום:\s*/u, '').trim();

  return (
    <button
      {...props}
      className="str-chat__context-menu__button str-chat__message-actions-list-item-button run-chat-edit-plan-action"
      data-testid="edit-plan-with-prompt"
      onClick={() => {
        openEditor(message.id, currentPlan);
        closeMenu();
      }}
    >
      <PencilLine
        className="str-chat__icon str-chat__context-menu__button__icon"
        aria-hidden="true"
      />
      <div className="str-chat__context-menu__button__label">
        {t('editPlanWithPrompt')}
      </div>
    </button>
  );
}

export function RunChatMessageActions() {
  const actionSet = useMemo(() => {
    const menuToggle = defaultMessageActionSet.filter(
      ({ placement }) => placement === 'quick-dropdown-toggle',
    );
    const defaultActions = defaultMessageActionSet.filter(
      ({ placement }) => placement !== 'quick-dropdown-toggle',
    );
    return [
      ...menuToggle,
      {
        Component: PlanEditAction,
        placement: 'dropdown' as const,
        type: 'edit-plan-prompt',
      },
      ...defaultActions,
    ];
  }, []);

  return <MessageActions messageActionSet={actionSet} />;
}

interface PlanEditPromptProviderProps {
  chatId: string;
  supabaseToken: string;
  children: ReactNode;
}

export function PlanEditPromptProvider({
  chatId,
  supabaseToken,
  children,
}: PlanEditPromptProviderProps) {
  const t = useTranslations('runChat');
  const [messageId, setMessageId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (submitting) return;
    setMessageId(null);
    setPrompt('');
    setError(null);
  };

  const openEditor: OpenPlanEditor = (nextMessageId, currentPlan) => {
    setMessageId(nextMessageId);
    setPrompt(currentPlan);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!messageId || !prompt.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/run-chat/${chatId}/plan`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plannedText: prompt.trim(), messageId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t('editPlanFailed'));
      setMessageId(null);
      setPrompt('');
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('editPlanFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PlanEditContext.Provider value={openEditor}>
      {children}
      {messageId && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/75 p-4"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) close();
              }}
            >
              <form
                className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 text-start shadow-2xl"
                data-testid="edit-plan-dialog"
                dir="rtl"
                onSubmit={submit}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{t('editPlanTitle')}</h2>
                    <p className="mt-1 text-sm text-slate-400">{t('editPlanDescription')}</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                    aria-label={t('close')}
                    onClick={close}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  autoFocus
                  className="min-h-28 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-400"
                  data-testid="edit-plan-prompt"
                  value={prompt}
                  placeholder={t('editPlanPlaceholder')}
                  onChange={(event) => setPrompt(event.target.value)}
                />
                {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <Button type="button" variant="ghost" disabled={submitting} onClick={close}>
                    {t('cancel')}
                  </Button>
                  <Button type="submit" disabled={submitting || !prompt.trim()}>
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t('rebuildPlan')}
                  </Button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </PlanEditContext.Provider>
  );
}
