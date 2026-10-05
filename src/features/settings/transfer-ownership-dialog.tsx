import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Crown, RefreshCw, Search, UserRoundCog } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { organizationsApi, workspaceApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { Member, Organization } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDebouncedValue } from '@/lib/hooks';
import { activeMembersInfiniteQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { invalidateAfterTransfer } from '@/lib/workspace/cache';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { MemberIdentity, RoleChips } from '@/features/team/member-bits';

/**
 * Transfer ownership (spec P2-API-03): pick an active member from every page,
 * review what happens to both role sets, then type the workspace name. The
 * request takes the member's USER id (never the membership id). Never retried:
 * a lost answer is reconciled by reading the owner back.
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
  // Frozen when the dialog opened (spec §4 "Freeze target IDs when a dialog opens").
  const [workspaceId] = useState(workspace.id);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const [chosen, setChosen] = useState<Member | null>(null);
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);

  const candidates = useInfiniteQuery(activeMembersInfiniteQuery(workspaceId, debounced));
  const pages = candidates.data?.pages ?? [];
  // The current owner can't be chosen (400): compare user ids, not role names.
  const list = pages.flatMap((page) => page.items).filter((member) => member.userId !== organization.ownerId);
  const total = pages[0]?.pagination.totalItems;

  const succeed = (updated: Organization, member: Member) => {
    queryClient.setQueryData(queryKeys.details(workspaceId), updated);
    toast.success(`${member.displayName} now owns ${organization.name}`, {
      description: 'Your roles here were replaced with Administrator. Owner-only actions are no longer available to you.',
    });
    // Navigation and actions are rebuilt from re-read access, not from this answer.
    void invalidateAfterTransfer(workspaceId);
    onClose();
  };

  const transfer = useMutation({
    mutationFn: (member: Member) => workspaceApi.transferOwnership(workspaceId, member.userId),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (updated, member) => succeed(updated, member),
    onError: (err) => {
      if (isOutcomeUnknown(err)) {
        setUncertain(err);
        return;
      }
      if (hasCode(err, 'MEMBERSHIP_NOT_FOUND')) {
        setError('That person is no longer an active member. Choose someone else.');
        setStep('choose');
        setChosen(null);
        void queryClient.invalidateQueries({ queryKey: queryKeys.members(workspaceId) });
        return;
      }
      if (hasCode(err, 'FORBIDDEN')) {
        // Ownership already moved (another tab, another owner action): re-read who owns it.
        void invalidateAfterTransfer(workspaceId);
      }
      setError(messageFor(err));
    },
  });

  /** After a lost answer: read the owner back before allowing another attempt (spec P2-API-03). */
  const reconcile = async () => {
    if (!chosen) return;
    setChecking(true);
    try {
      const current = await organizationsApi.get(workspaceId);
      queryClient.setQueryData(queryKeys.details(workspaceId), current);
      if (current.ownerId === chosen.userId) {
        succeed(current, chosen);
        return;
      }
      setUncertain(null);
      setError(
        current.ownerId === organization.ownerId
          ? "The transfer didn't happen: you're still the owner. You can try again."
          : 'Ownership changed to someone else meanwhile. Close this and check the workspace.',
      );
    } catch (readError) {
      setError(`We still couldn't confirm it: ${messageFor(readError)}`);
    } finally {
      setChecking(false);
    }
  };

  const confirmed = typed.trim() === organization.name.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 'choose') {
      if (chosen) {
        setError(null);
        setStep('confirm');
      }
      return;
    }
    if (chosen && confirmed && !uncertain) {
      setError(null);
      transfer.mutate(chosen);
    }
  };

  const pendingAny = transfer.isPending || checking;

  return (
    <form onSubmit={submit} noValidate className="contents">
      <DialogHeader
        icon={<UserRoundCog />}
        title={`Transfer ownership of ${organization.name}`}
        description={
          step === 'choose'
            ? 'Choose the active member who should own this workspace.'
            : 'Review what changes for both of you, then confirm by typing the workspace name.'
        }
      />
      {step === 'choose' ? (
        <DialogBody className="grid gap-3">
          <Input
            leading={<Search />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email"
            aria-label="Search active members"
            maxLength={200}
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
                description={debounced ? 'Only active members can become the owner.' : 'Only active members can become the owner.'}
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
                {candidates.hasNextPage ? (
                  <li className="p-2 text-center">
                    <Button variant="ghost" size="sm" loading={candidates.isFetchingNextPage} onClick={() => void candidates.fetchNextPage()}>
                      Show more members
                    </Button>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
          {total !== undefined ? (
            <p className="text-xs text-muted tabular" aria-live="polite">
              {total} active {total === 1 ? 'member' : 'members'}
              {debounced ? ` match “${debounced}”` : ''}, including you.
            </p>
          ) : null}
          <FormError message={error ?? undefined} />
        </DialogBody>
      ) : chosen ? (
        <DialogBody className="grid gap-4">
          <div className="grid gap-2 rounded-lg border border-line bg-well/40 p-3.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-3">
              <MemberIdentity member={chosen} className="min-w-0 flex-1" />
              <ArrowRight className="size-4 text-faint" aria-hidden />
              <span className="inline-flex items-center gap-1.5 font-medium text-brand-800">
                <Crown className="size-4" aria-hidden />
                Owner only
              </span>
            </div>
            <p className="text-xs text-muted">
              Their current roles (<RoleSummary member={chosen} />) are replaced by the Owner role alone.
            </p>
          </div>
          <Callout tone="warning" title="Both role sets are replaced, not added to">
            {chosen.displayName} gets only the Owner role. You get only the Administrator role: any other roles you hold
            here, custom ones included, are removed. You lose owner-only actions (transfer and delete), and only the new
            owner can transfer it back.
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
              disabled={pendingAny}
            />
          </Field>
          {uncertain ? (
            <OutcomeUnknown
              error={uncertain}
              action={
                <Button size="xs" variant="secondary" loading={checking} onClick={() => void reconcile()}>
                  {checking ? null : <RefreshCw />}
                  Check who owns it now
                </Button>
              }
            >
              The transfer may have happened. Check the current owner before trying again.
            </OutcomeUnknown>
          ) : null}
          <FormError message={error ?? undefined} />
        </DialogBody>
      ) : null}
      <DialogFooter className={step === 'confirm' ? 'sm:justify-between' : undefined}>
        {step === 'confirm' ? (
          <Button variant="ghost" onClick={() => setStep('choose')} disabled={pendingAny || !!uncertain}>
            <ArrowLeft />
            Back
          </Button>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onClose} disabled={pendingAny}>
            Cancel
          </Button>
          {step === 'choose' ? (
            <Button type="submit" disabled={!chosen}>
              Continue
            </Button>
          ) : (
            <Button type="submit" variant="danger" loading={transfer.isPending} disabled={!confirmed || !!uncertain || checking}>
              Transfer ownership
            </Button>
          )}
        </div>
      </DialogFooter>
    </form>
  );
}

function RoleSummary({ member }: { member: Member }) {
  if (member.roles.length === 0) return <>none</>;
  return <>{[...member.roles].sort((a, b) => b.priority - a.priority).map((role) => role.name).join(', ')}</>;
}
