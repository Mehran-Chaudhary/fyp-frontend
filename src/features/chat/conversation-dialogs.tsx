import { PenLine, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { hasCode } from '@/lib/api/errors';
import type { Conversation } from '@/lib/api/types';
import { CONVERSATION_TITLE_MAX } from '@/lib/agents/limits';
import { conversationTitle } from '@/lib/agents/messages';
import { messageFor } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { useConversationActions } from './use-conversation-actions';

/** Rename (owner only, P4-API-15). The title is stored encrypted. */
export function RenameConversationDialog({ conversation, onClose }: { conversation: Conversation | null; onClose: () => void }) {
  return (
    <Dialog open={!!conversation} onOpenChange={(open) => (open ? null : onClose())}>
      {conversation ? <RenameBody key={conversation.id} conversation={conversation} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RenameBody({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { update } = useConversationActions();
  const [title, setTitle] = useState(conversation.title ?? '');
  const [error, setError] = useState<string | null>(null);
  const trimmed = title.trim();

  const submit = () => {
    if (!trimmed) {
      setError('Give it a title.');
      return;
    }
    if (trimmed === conversation.title) {
      onClose();
      return;
    }
    update.mutate(
      { id: conversation.id, body: { title: trimmed } },
      {
        onSuccess: () => onClose(),
        onError: (failure) => setError(hasCode(failure, 'VALIDATION_FAILED') ? `Use 1 to ${CONVERSATION_TITLE_MAX} characters.` : messageFor(failure)),
      },
    );
  };

  return (
    <DialogContent size="md">
      <form
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogHeader icon={<PenLine />} title="Rename conversation" />
        <DialogBody>
          <Field label="Title" error={error ?? undefined} labelAside={<span className="text-xs text-faint tabular">{trimmed.length}/{CONVERSATION_TITLE_MAX}</span>}>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={CONVERSATION_TITLE_MAX} autoFocus />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={update.isPending}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/**
 * Delete (P4-API-16): the key is shredded, so the content is gone at once. A
 * supervisor deleting someone else's conversation is told whose it is (P4-G09).
 */
export function DeleteConversationDialog({
  conversation,
  ownerName,
  onClose,
  onDeleted,
}: {
  conversation: Conversation | null;
  ownerName?: string | null;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}) {
  const { remove } = useConversationActions();
  const [error, setError] = useState<string | null>(null);
  const someoneElse = !!conversation && !conversation.isOwner;

  return (
    <ConfirmDialog
      open={!!conversation}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          onClose();
        }
      }}
      icon={<Trash2 />}
      tone="danger"
      title={someoneElse ? `Delete ${ownerName ? `${ownerName}'s` : "someone else's"} conversation?` : 'Delete this conversation?'}
      description={
        <>
          {someoneElse ? (
            <span className="mb-1.5 block font-medium text-danger-700">
              This is {ownerName ? `${ownerName}'s` : conversation?.ownerKind === 'api_key' ? 'an API client’s' : 'another member’s'} conversation, not yours.
            </span>
          ) : null}
          “{conversation ? conversationTitle(conversation) : ''}”. Its messages are destroyed immediately and cannot be recovered.
        </>
      }
      confirmLabel="Delete for good"
      onConfirm={() => {
        if (!conversation) return;
        setError(null);
        remove.mutate(conversation.id, {
          onSuccess: () => {
            toast.success('Conversation deleted');
            onDeleted?.(conversation.id);
            onClose();
          },
          onError: (failure) => {
            if (hasCode(failure, 'CONVERSATION_NOT_FOUND')) {
              onDeleted?.(conversation.id);
              onClose();
              return;
            }
            setError(messageFor(failure));
          },
        });
      }}
      pending={remove.isPending}
      error={error}
    />
  );
}
