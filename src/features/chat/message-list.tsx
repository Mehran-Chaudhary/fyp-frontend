import { ArrowDown, ChevronsUp } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { Message, TurnResult } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { AssistantMessage, UserBubble, WithheldRow } from './message-view';

interface MessageListProps {
  messages: readonly Message[];
  agentName: string;
  results?: ReadonlyMap<string, TurnResult>;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** Above the first message: the greeting banner, the start-of-conversation marker. */
  top?: ReactNode;
  /** After the last message: the turn in progress. */
  bottom?: ReactNode;
  /** Changes whenever the bottom grows (streamed text), to keep following it. */
  followKey?: string | number;
  className?: string;
}

/**
 * The scrolling history (§5.6 "History"): newest at the bottom, older pages loaded
 * as you scroll up (keeping your place), and the view follows a streaming answer
 * only while you're at the bottom.
 */
export function MessageList({ messages, agentName, results, hasOlder, loadingOlder, onLoadOlder, top, bottom, followKey, className }: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const restoreFromBottom = useRef<number | null>(null);
  const [away, setAway] = useState(false);
  const firstId = messages[0]?.id;

  const loadOlder = () => {
    const element = scroller.current;
    if (!element || !hasOlder || loadingOlder) return;
    restoreFromBottom.current = element.scrollHeight - element.scrollTop;
    onLoadOlder();
  };

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stuck.current = distance < 120;
    setAway(distance > 480);
    if (element.scrollTop < 160) loadOlder();
  };

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (restoreFromBottom.current !== null) {
      if (loadingOlder) return;
      // Older messages were added above: keep the ones you were reading in place.
      element.scrollTop = element.scrollHeight - restoreFromBottom.current;
      restoreFromBottom.current = null;
      return;
    }
    if (stuck.current) element.scrollTop = element.scrollHeight;
  }, [firstId, messages.length, followKey, loadingOlder]);

  const jump = () => {
    const element = scroller.current;
    if (!element) return;
    stuck.current = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({ top: element.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <div ref={scroller} onScroll={onScroll} className="scrollbar-thin h-full overflow-y-auto" aria-label="Messages" role="region" tabIndex={-1}>
        <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 pt-6 pb-8 sm:px-6">
          {hasOlder ? (
            <div className="flex justify-center">
              <Button variant="ghost" size="xs" onClick={loadOlder} loading={loadingOlder}>
                {loadingOlder ? null : <ChevronsUp />}
                Earlier messages
              </Button>
            </div>
          ) : (
            top
          )}
          {messages.map((message, index) => (
            <div key={message.id} className="grid gap-6">
              {startsNewDay(messages[index - 1], message) ? <DaySeparator iso={message.createdAt} /> : null}
              {message.contentState === 'WITHHELD' ? (
                <WithheldRow message={message} />
              ) : message.role === 'USER' ? (
                <UserBubble content={message.content ?? ''} time={message.createdAt} />
              ) : (
                <AssistantMessage message={message} result={results?.get(message.id)} agentName={agentName} />
              )}
            </div>
          ))}
          {bottom}
        </div>
      </div>
      {away ? (
        <Button variant="secondary" size="sm" className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-pop" onClick={jump}>
          <ArrowDown />
          Latest
        </Button>
      ) : null}
      {loadingOlder ? (
        <span className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface p-1.5 shadow-card" aria-label="Loading earlier messages">
          <Spinner className="size-3.5" />
        </span>
      ) : null}
    </div>
  );
}

function startsNewDay(previous: Message | undefined, current: Message): boolean {
  if (!previous) return true;
  return new Date(previous.createdAt).toDateString() !== new Date(current.createdAt).toDateString();
}

function DaySeparator({ iso }: { iso: string }) {
  const label = new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="flex items-center gap-3 text-[11px] font-medium tracking-[0.06em] text-faint uppercase" role="separator">
      <span className="h-px flex-1 bg-line" />
      <time dateTime={iso}>{label}</time>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
