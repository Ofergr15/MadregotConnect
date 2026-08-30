'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import {
  TextareaComposer as StreamTextareaComposer,
  useMessageComposerContext,
  useMessageComposerController,
  useStateStore,
  type TextareaComposerProps,
} from 'stream-chat-react';
import { cn } from '@/lib/utils';

function getSelection(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  const startRange = range.cloneRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = range.cloneRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
}

function setSelection(root: HTMLElement, start: number, end: number) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let offset = 0;
  let startNode: Node = root;
  let startOffset = 0;
  let endNode: Node = root;
  let endOffset = 0;

  while (node) {
    const nextOffset = offset + (node.textContent?.length ?? 0);
    if (start >= offset && start <= nextOffset) {
      startNode = node;
      startOffset = start - offset;
    }
    if (end >= offset && end <= nextOffset) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset = nextOffset;
    node = walker.nextNode();
  }

  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch {
    range.selectNodeContents(root);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

/**
 * Stream's textarea triggers iOS Safari's large previous/next/done input bar.
 * A plain-text contenteditable keeps Stream's composer controller while giving
 * the mobile chat the same compact keyboard transition as ChatGPT.
 */
function MobileContentEditable({
  className,
  containerClassName,
  onBlur,
  onFocus,
  onKeyDown,
  onPaste,
  onSelect,
  placeholder = 'כתוב הודעה',
}: TextareaComposerProps) {
  const editableRef = useRef<HTMLDivElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const messageComposer = useMessageComposerController();
  const { handleSubmit } = useMessageComposerContext();
  const { selection, text } = useStateStore(messageComposer.textComposer.state, (state) => ({
    selection: state.selection,
    text: state.text,
  }));

  const updateComposer = (element: HTMLElement) => {
    const nextSelection = getSelection(element) ?? {
      start: element.innerText.length,
      end: element.innerText.length,
    };
    void messageComposer.textComposer.handleChange({
      selection: nextSelection,
      text: element.innerText.replace(/\r/g, ''),
    });
  };

  const handleInput = (event: FormEvent<HTMLDivElement>) => {
    updateComposer(event.currentTarget);
  };

  const handleSelection = (event: SyntheticEvent<HTMLDivElement>) => {
    onSelect?.(event as unknown as SyntheticEvent<HTMLTextAreaElement>);
    const nextSelection = getSelection(event.currentTarget);
    if (nextSelection) messageComposer.textComposer.setSelection(nextSelection);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event as unknown as KeyboardEvent<HTMLTextAreaElement>);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;

    if (event.key === 'Escape' && messageComposer.textComposer.suggestions) {
      messageComposer.textComposer.closeSuggestions();
      return;
    }

    if (event.key !== 'Enter') return;
    event.preventDefault();

    if (event.shiftKey) {
      const nextSelection = getSelection(event.currentTarget) ?? selection;
      void messageComposer.textComposer.insertText({ text: '\n', selection: nextSelection });
      return;
    }

    if (messageComposer.hasSendableData) void handleSubmit();
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    onPaste?.(event as unknown as ClipboardEvent<HTMLTextAreaElement>);
    if (event.defaultPrevented) return;

    event.preventDefault();
    const pastedText = event.clipboardData.getData('text/plain');
    if (!pastedText) return;
    const nextSelection = getSelection(event.currentTarget) ?? selection;
    void messageComposer.textComposer.insertText({
      text: pastedText,
      selection: nextSelection,
    });
  };

  useLayoutEffect(() => {
    const editable = editableRef.current;
    if (!editable || isComposing) return;

    if (editable.innerText.replace(/\r/g, '') !== text) {
      editable.textContent = text;
    }
    if (document.activeElement === editable) {
      setSelection(editable, selection.start, selection.end);
    }
  }, [isComposing, selection.end, selection.start, text]);

  return (
    <div className={cn('rta str-chat__textarea', containerClassName)}>
      <div
        ref={editableRef}
        role="textbox"
        aria-label={text ? 'הודעה' : placeholder}
        aria-multiline="true"
        className={cn(
          'run-chat-contenteditable str-chat__textarea__textarea str-chat__message-textarea',
          className,
        )}
        contentEditable="plaintext-only"
        data-placeholder={placeholder}
        data-testid="message-input"
        dir="auto"
        onBlur={(event) => {
          handleSelection(event);
          onBlur?.(event as unknown as FocusEvent<HTMLTextAreaElement>);
        }}
        onCompositionEnd={(event) => {
          setIsComposing(false);
          updateComposer(event.currentTarget);
        }}
        onCompositionStart={() => setIsComposing(true)}
        onFocus={(event) =>
          onFocus?.(event as unknown as FocusEvent<HTMLTextAreaElement>)
        }
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={handleSelection}
        onPaste={handlePaste}
        onPointerUp={handleSelection}
        suppressContentEditableWarning
      />
    </div>
  );
}

export function RunChatContentEditable(props: TextareaComposerProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile ? (
    <MobileContentEditable {...props} />
  ) : (
    <StreamTextareaComposer {...props} />
  );
}
