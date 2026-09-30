import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Crown, Search, UserRoundCog } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { workspaceApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { Member, Organization } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDebouncedValue } from '@/lib/hooks';
import { membersQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { invalidateAfterTransfer } from '@/lib/workspace/cache';
import { useAccess } from '@/features/workspaces/use-access';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { MemberIdentity, RoleChips } from '@/features/team/member-bits';

/**
 * Transfer ownership (spec §5.7, E32): pick an active member, then type the
 * workspace name. The request takes the member's USER id; sending the
 * membership id is refused.
 */
export function TransferOwnershipDialog({
  organization,
  open,
  onOpenChange,
}: {
  organization: Organization;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [session, setSession] = useState(0);
  const [busy, setBusy] = useState(false);
  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => setSession((value) => value + 1), 200);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : !busy && close())}>
      <DialogContent size="lg" onInteractOutside={(event) => event.preventDefault()}>
        <TransferFlow key={session} organization={organization} onClose={close} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}

function TransferFlow({
  organization,
  onClose,
  onBusyChange,
}: {
  organization: Organization;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const workspace = useWorkspace();
  const access = useAccess();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const [chosen, setChosen] = useState<Member | null>(null);
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const candidates = useQuery(
    membersQuery(workspace.id, { status: 'ACTIVE', limit: 50, sortBy: 'name', sortDirection: 'ASC', ...(debounced ? { search: debounced } : {}) }),
  );
  const list = (candidates.data?.items ?? []).filter((member) => member.id !== access.membership.id);

  const transfer = useMutation({
    mutationFn: (member: Member) => workspaceApi.transferOwnership(workspace.id, member.userId),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (updated, member) => {
      queryClient.setQueryData(queryKeys.details(workspace.id), updated);
      toast.success(`${member.displayName} now owns ${organization.name}`, {
        description: "You're an Administrator of this workspace now.",
      });
      void invalidateAfterTransfer(workspace.id);
      onClose();
    },
    onError: (err) => {
      if (hasCode(err, 'MEMBERSHIP_NOT_FOUND')) {
        setError('That person is no longer an active member. Choose someone else.');
        setStep('choose');
        setChosen(null);
        void queryClient.invalidateQueries({ queryKey: queryKeys.members(workspace.id) });
        return;
      }
      setError(messageFor(err));
    },
  });

  const confirmed = typed === organization.name;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 'choose') {
      if (chosen) {
        setError(null);
        setStep('confirm');
      }
      return;
    }
    if (chosen && confirmed) transfer.mutate(chosen);
  };

  return (
    <form onSubmit={submit} noValidate className="contents">
      <DialogHeader
        icon={<UserRoundCog />}
        title="Transfer ownership"
        description={
          step === 'choose'
            ? 'Choose the active member who should own this workspace.'
            : 'Check the details, then confirm by typing the workspace name.'
        }
      />
      {step === 'choose' ? (
        <DialogBody className="grid gap-3">
          <Input
            leading={<Search />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email"
            aria-label="Search members"
            autoFocus
          />
          <div className="scrollbar-thin max-h-80 min-h-40 overflow-y-auto rounded-lg border border-line" role="radiogroup" aria-label="New owner">
            {candidates.isPending ? (
              <div className="grid gap-3 p-3">
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : candidates.isError ? (
              <ErrorState compact error={candidates.error} onRetry={() => void candidates.refetch()} />
            ) : list.length === 0 ? (
              <EmptyState
                className="py-10"
                title={debounced ? 'Nobody matches' : 'No one else is active here'}
                description={debounced ? 'Only active members can become the owner.' : 'Invite someone first; only active members can become the owner.'}
              />
            ) : (
              <ul className="divide-y divide-line/70">
                {list.map((member) => {
                  const selected = chosen?.id === member.id;
                  return (
                    <li key={member.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setChosen(member)}
                        className={cn(
                          'flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13px] transition-colors',
                          selected ? 'bg-brand-50/70' : 'hover:bg-well/50',
                        )}
                      >
                        <MemberIdentity member={member} className="flex-1" />
                        <span className="hidden sm:block">
                          <RoleChips member={member} />
                        </span>
                        <span
                          className={cn(
                            'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border',
                            selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface',
                          )}
                          aria-hidden
                        >
                          {selected ? <Check className="size-3" strokeWidth={3} /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {candidates.data && candidates.data.pagination.totalItems > 50 && !debounced ? (
            <p className="text-xs text-muted">Showing the first 50 members. Search to find someone else.</p>
          ) : null}
          <FormError message={error ?? undefined} />
        </DialogBody>
      ) : chosen ? (
        <DialogBody className="grid gap-4">
          <div className="flex items-center gap-3 rounded-lg border border-line bg-well/40 px-3.5 py-3">
            <MemberIdentity member={chosen} className="flex-1" />
            <Crown className="size-4 text-brand-600" aria-hidden />
          </div>
          <Callout tone="warning" title={`${chosen.displayName} becomes the owner. You become an Administrator.`}>
            Only the owner can transfer or delete the workspace. You keep administrator access, but you can't undo this
            yourself: only the new owner can transfer it back.
          </Callout>
          <Field
            label={
              <>
                Type <span className="font-semibold text-ink">{organization.name}</span> to confirm
              </>
            }
          >
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={organization.name}
              autoFocus
              disabled={transfer.isPending}
            />
          </Field>
          <FormError message={error ?? undefined} />
        </DialogBody>
      ) : null}
      <DialogFooter className={step === 'confirm' ? 'sm:justify-between' : undefined}>
        {step === 'confirm' ? (
          <Button variant="ghost" onClick={() => setStep('choose')} disabled={transfer.isPending}>
            <ArrowLeft />
            Back
          </Button>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onClose} disabled={transfer.isPending}>
            Cancel
          </Button>
          {step === 'choose' ? (
            <Button type="submit" disabled={!chosen}>
              Continue
            </Button>
          ) : (
            <Button type="submit" variant="danger" loading={transfer.isPending} disabled={!confirmed}>
              Transfer ownership
            </Button>
          )}
        </div>
      </DialogFooter>
    </form>
  );
}
