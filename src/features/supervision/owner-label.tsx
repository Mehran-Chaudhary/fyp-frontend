import { KeyRound, UserRound } from 'lucide-react';
import type { Conversation } from '@/lib/api/types';

/** Who a conversation belongs to: a member's name when it can be resolved, or "API client". */
export function OwnerLabel({ conversation, name, canResolve }: { conversation: Conversation; name: string | null; canResolve: boolean }) {
  if (conversation.ownerKind === 'api_key') {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-soft">
        <KeyRound className="size-3.5 text-faint" aria-hidden />
        API client
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-soft">
      <UserRound className="size-3.5 shrink-0 text-faint" aria-hidden />
      <span className="truncate">{name ?? (canResolve ? 'Unknown member' : 'A member')}</span>
    </span>
  );
}
