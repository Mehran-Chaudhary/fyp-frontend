import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { Button } from '@/components/ui/button';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { membersApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { Member, UpdateMemberProfileRequest } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { invalidateMembers } from '@/lib/workspace/cache';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { handleMemberGone, memberActionMessage, storeMember } from './member-helpers';

const schema = z.object({
  displayName: z.string().trim().max(120, 'Use no more than 120 characters.'),
  title: z.string().trim().max(120, 'Use no more than 120 characters.'),
});
type Values = z.infer<typeof schema>;

/**
 * A member's profile in this workspace (P2-API-11): a local display name and a
 * title. The server returns the local name OR the account's fallback in one
 * field, so the form never guesses which it is: it sends only fields you
 * changed, and "Use the account name" clears the local name explicitly
 * (spec §4 "Member lifecycle", P2-T29). Account name, email and avatar are not
 * edited here.
 */
export function MemberProfileForm({
  member,
  isYou,
  onDone,
  onGone,
}: {
  member: Member;
  isYou: boolean;
  onDone: () => void;
  onGone?: () => void;
}) {
  const workspace = useWorkspace();
  const workspaceId = workspace.id;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: member.displayName, title: member.title ?? '' },
  });
  const { errors, dirtyFields, isDirty } = form.formState;
  const [uncertain, setUncertain] = useState<unknown>(null);

  const save = useMutation({
    mutationFn: (body: UpdateMemberProfileRequest) => membersApi.updateProfile(workspaceId, member.id, body),
    onSuccess: (updated, body) => {
      storeMember(workspaceId, updated);
      if (isYou) void queryClient.invalidateQueries({ queryKey: queryKeys.membership(workspaceId) });
      const who = isYou ? 'Your workspace profile' : `${updated.displayName}'s profile`;
      toast.success(
        body.displayName === '' && Object.keys(body).length === 1 ? `${who} uses the account name again` : `${who} is saved`,
      );
      onDone();
    },
    onError: (error) => {
      if (hasCode(error, 'MEMBERSHIP_NOT_FOUND')) {
        handleMemberGone(workspaceId, member.displayName);
        onGone?.();
        return;
      }
      if (isOutcomeUnknown(error)) {
        setUncertain(error);
        void invalidateMembers(workspaceId);
        if (isYou) void queryClient.invalidateQueries({ queryKey: queryKeys.membership(workspaceId) });
        return;
      }
      if (hasCode(error, 'FORBIDDEN', 'PERMISSION_DENIED')) {
        form.setError('root.server', { message: memberActionMessage(error) });
        return;
      }
      applyServerErrors(form, error, { fields: ['displayName', 'title'] });
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    // Only what changed; '' clears that field on the server.
    const body: UpdateMemberProfileRequest = {};
    if (dirtyFields.displayName) body.displayName = values.displayName;
    if (dirtyFields.title) body.title = values.title;
    if (Object.keys(body).length === 0) {
      onDone();
      return;
    }
    setUncertain(null);
    save.mutate(body);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <Field
        label="Display name in this workspace"
        error={errors.displayName?.message}
        hint="Shown to people in this workspace only. Leave empty, or use the account name, to show the account's name."
      >
        <Input autoFocus maxLength={120} placeholder="The account name" {...form.register('displayName')} />
      </Field>
      <div className="-mt-2">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            setUncertain(null);
            save.mutate({ displayName: '' });
          }}
          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
        >
          <RotateCcw className="size-3" aria-hidden />
          Use the account name instead
        </button>
      </div>
      <Field label="Title" optional error={errors.title?.message} hint="For example “Head of People”. Leave empty to remove it.">
        <Input maxLength={120} placeholder="Job title" {...form.register('title')} />
      </Field>
      {uncertain ? (
        <OutcomeUnknown error={uncertain}>
          The change may have been saved. The profile is being re-read; check it before saving again.
        </OutcomeUnknown>
      ) : null}
      <FormError message={errors.root?.server?.message} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!isDirty} loading={save.isPending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}
