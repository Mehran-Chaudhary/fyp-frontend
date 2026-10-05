import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, MailPlus, RefreshCw, ShieldOff, Send } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { invitationsApi } from '@/lib/api/endpoints';
import { hasCode, isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { Role } from '@/lib/api/types';
import { applyServerErrors, detailList, messageFor } from '@/lib/errors';
import { pendingInvitationsQuery, queryKeys, rolesQuery, workspaceDetailsQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { grantableRoles } from '@/lib/rbac/rules';
import { toast, toastError } from '@/lib/toast';
import { formatDate, formatDateTime, pluralize } from '@/lib/utils';
import { invalidateInvitations } from '@/lib/workspace/cache';
import { isEmailAllowed, normaliseDomain } from '@/lib/workspace/domains';
import { useAccess } from '@/features/workspaces/use-access';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { RoleDot } from './member-bits';

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter an email address.')
    .max(320, 'Email addresses are at most 320 characters.')
    .pipe(z.email('Enter a valid email address.')),
  message: z.string().max(1000, 'Use no more than 1000 characters.'),
});
type Values = z.infer<typeof schema>;

/**
 * "Invite people" (P2-API-17). Success means the invitation was stored and an
 * email was attempted; delivery can't be confirmed from here. Never resent
 * automatically: after a lost answer the pending invitations are checked first.
 */
export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // A fresh form every time the dialog is reopened (after the close animation).
  const [session, setSession] = useState(0);
  const [busy, setBusy] = useState(false);

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => setSession((value) => value + 1), 200);
  };

  return (
    // Escape and outside clicks are ignored while a request is in flight.
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : !busy && close())}>
      <DialogContent size="lg">
        <InviteForm key={session} onClose={close} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}

type Problem =
  | { kind: 'pending'; email: string; invitationId: string | null; expiresAt: string | null }
  | { kind: 'suspended'; email: string }
  | { kind: 'uncertain'; email: string; error: unknown }
  | { kind: 'found'; email: string; expiresAt: string; createdAt: string };

function InviteForm({ onClose, onBusyChange }: { onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const workspace = useWorkspace();
  const can = useCan();
  const access = useAccess();
  const canReadRoles = can('role:read');
  const roles = useQuery({ ...rolesQuery(workspace.id), enabled: canReadRoles });
  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: can('workspace:read') });

  const [chosenRoleId, setChosenRoleId] = useState<string | undefined>(undefined);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', message: '' } });
  const { errors, isSubmitting } = form.formState;
  const message = useWatch({ control: form.control, name: 'message' }) ?? '';

  const allowedDomains = (details.data?.settings.allowedEmailDomains ?? []).map(normaliseDomain).filter(Boolean);
  // Without role:read the role list can't be shown; the server applies the default role.
  const rolesUnavailable = !canReadRoles || hasCode(roles.error, 'PERMISSION_DENIED');
  const grantable: Role[] =
    roles.data && access.ready
      ? grantableRoles(roles.data, access.myPriority, access.myPermissions, access.catalogueKeys)
      : [];
  const defaultRole = grantable.find((role) => role.isDefault) ?? grantable[0];
  const roleId = chosenRoleId && grantable.some((role) => role.id === chosenRoleId) ? chosenRoleId : defaultRole?.id;

  const resend = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.resend(workspace.id, invitationId),
    onSuccess: (invitation) => {
      toast.success(`New invitation link for ${invitation.email}`, {
        description: `Email delivery was attempted. Only the newest email's link works; it expires ${formatDate(invitation.expiresAt)}.`,
      });
      void invalidateInvitations(workspace.id);
      onClose();
    },
    onError: (error) => {
      if (hasCode(error, 'RATE_LIMIT_EXCEEDED')) setRateLimitedUntil(error.retryDeadline(60 * 60));
      else toastError(error, "Couldn't resend the invitation");
      void invalidateInvitations(workspace.id);
    },
  });

  const onSubmit = form.handleSubmit(async ({ email, message: note }) => {
    setProblem(null);
    setRoleError(null);
    if (!isEmailAllowed(email, allowedDomains)) {
      form.setError('email', { message: `This workspace only accepts members from: ${allowedDomains.join(', ')}.` }, { shouldFocus: true });
      return;
    }
    onBusyChange(true);
    try {
      const invitation = await invitationsApi.create(workspace.id, {
        email,
        ...(roleId ? { roleId } : {}),
        ...(note.trim() ? { message: note.trim() } : {}),
      });
      toast.success(`Invitation created for ${invitation.email}`, {
        description: `Email delivery was attempted (it can't be confirmed from here). They'd join as ${invitation.role?.name ?? 'the default role'} and have until ${formatDate(invitation.expiresAt)} to accept.`,
      });
      void invalidateInvitations(workspace.id);
      onBusyChange(false);
      onClose();
    } catch (error) {
      onBusyChange(false);
      if (isOutcomeUnknown(error)) {
        setProblem({ kind: 'uncertain', email, error });
        return;
      }
      if (!isApiError(error)) {
        form.setError('root.server', { message: messageFor(error) });
        return;
      }
      switch (error.code) {
        case 'INVITATION_ALREADY_PENDING':
          setProblem({
            kind: 'pending',
            email,
            invitationId: typeof error.details?.invitationId === 'string' ? error.details.invitationId : null,
            expiresAt: typeof error.details?.expiresAt === 'string' ? error.details.expiresAt : null,
          });
          break;
        case 'MEMBERSHIP_ALREADY_EXISTS':
          form.setError('email', { message: `${email} is already a member of ${workspace.name}.` }, { shouldFocus: true });
          break;
        case 'MEMBERSHIP_SUSPENDED':
          setProblem({ kind: 'suspended', email });
          break;
        case 'BAD_REQUEST': {
          const domains = detailList(error, 'allowedDomains');
          if (domains.length) {
            form.setError('email', { message: `This workspace only accepts members from: ${domains.join(', ')}.` }, { shouldFocus: true });
            void queryClient.invalidateQueries({ queryKey: queryKeys.details(workspace.id) });
          } else {
            form.setError('root.server', { message: error.message });
          }
          break;
        }
        case 'CANNOT_ESCALATE_PRIVILEGES': {
          const denied = detailList(error, 'deniedPermissions');
          const rolePriority = error.details?.rolePriority;
          const yourPriority = error.details?.yourPriority;
          setRoleError(
            denied.length
              ? `You can't invite into this role: it grants ${denied.join(', ')}, which you don't hold.`
              : typeof rolePriority === 'number' && typeof yourPriority === 'number'
                ? `You can't invite into this role: it ranks ${rolePriority}, and you rank ${yourPriority}.`
                : `You can't invite into this role. ${error.message}`,
          );
          break;
        }
        case 'SEAT_LIMIT_REACHED': {
          const limit = error.details?.limit;
          const current = error.details?.current;
          form.setError('root.server', {
            message:
              typeof limit === 'number' && typeof current === 'number'
                ? `This workspace has ${pluralize(current, 'member')} and a limit of ${limit}. Pending invitations don't hold seats, but new ones can't be created until a seat is free.`
                : messageFor(error),
          });
          break;
        }
        case 'ROLE_NOT_FOUND':
          setRoleError('That role was just deleted. Pick another one.');
          setChosenRoleId(undefined);
          void queryClient.invalidateQueries({ queryKey: queryKeys.roles(workspace.id) });
          break;
        case 'RATE_LIMIT_EXCEEDED':
          setRateLimitedUntil(error.retryDeadline(60 * 60));
          break;
        default:
          applyServerErrors(form, error, { fields: ['email', 'message'] });
          if (error.code === 'VALIDATION_FAILED') {
            const roleMessage = error.fieldErrors({ fields: ['roleId'] }).roleId;
            if (roleMessage) setRoleError(roleMessage);
          }
      }
    }
  });

  /** After a lost answer: is there a pending invitation for this address now? (spec P2-API-17) */
  const checkPending = async (email: string) => {
    setChecking(true);
    try {
      const pending = await queryClient.fetchQuery({ ...pendingInvitationsQuery(workspace.id), staleTime: 0 });
      const match = pending.items.find((invitation) => invitation.email.toLowerCase() === email.toLowerCase());
      void invalidateInvitations(workspace.id);
      if (match) {
        setProblem({ kind: 'found', email: match.email, expiresAt: match.expiresAt, createdAt: match.createdAt });
      } else {
        setProblem(null);
        form.setError('root.server', {
          message: `No pending invitation for ${email} was found, so it wasn't created. You can send it now.`,
        });
      }
    } catch (checkError) {
      form.setError('root.server', { message: `We still couldn't check: ${messageFor(checkError)}` });
    } finally {
      setChecking(false);
    }
  };

  const header = (
    <DialogHeader
      icon={<MailPlus />}
      title={`Invite people to ${workspace.name}`}
      description="They get an email with a link to join. The link only exists in that email."
    />
  );

  // Roles still loading.
  if (canReadRoles && roles.isPending) {
    return (
      <>
        {header}
        <DialogBody className="grid gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </DialogBody>
      </>
    );
  }

  if (canReadRoles && roles.isError && !rolesUnavailable) {
    return (
      <>
        {header}
        <DialogBody>
          <ErrorState compact error={roles.error} title="We couldn't load the roles" onRetry={() => void roles.refetch()} retrying={roles.isFetching} />
        </DialogBody>
      </>
    );
  }

  // HR Manager's situation in the demo: every role includes something they lack (§3.2).
  if (!rolesUnavailable && grantable.length === 0) {
    return (
      <>
        {header}
        <DialogBody>
          <Callout tone="neutral" icon={<ShieldOff className="size-4" />} title="You can't invite anyone">
            Every role in this workspace includes permissions you don't have, and you can only invite people into a role
            whose permissions you hold yourself. Ask an administrator.
          </Callout>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  const roleOptions = grantable.map((role) => ({
    value: role.id,
    label: role.name,
    leading: <RoleDot color={role.color} className="mt-[5px]" />,
    description: role.description ?? undefined,
  }));

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      {header}
      <DialogBody className="grid gap-4">
        <Field
          label="Email address"
          error={errors.email?.message}
          hint={allowedDomains.length ? `Only addresses at: ${allowedDomains.join(', ')}` : undefined}
        >
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            autoFocus
            leading={<Mail />}
            placeholder={allowedDomains[0] ? `colleague@${allowedDomains[0]}` : 'colleague@company.com'}
            maxLength={320}
            {...form.register('email', {
              // An unresolved send stays until it's checked, whatever is typed next.
              onChange: () => setProblem((current) => (current?.kind === 'uncertain' ? current : null)),
            })}
          />
        </Field>

        {rolesUnavailable ? (
          <Callout tone="neutral">
            They'll join with this workspace's default role. Choosing a role needs{' '}
            <code className="font-mono text-[12px]">role:read</code>; the server still checks that you may grant the
            default role.
          </Callout>
        ) : (
          <Field
            label="Role"
            error={roleError ?? undefined}
            hint="Only roles that rank below you and whose permissions you hold are offered."
          >
            <Select
              value={roleId}
              onValueChange={(value) => {
                setChosenRoleId(value);
                setRoleError(null);
              }}
              options={roleOptions}
              placeholder="Choose a role"
            />
          </Field>
        )}

        <Field
          label="Personal message"
          optional
          error={errors.message?.message}
          hint={<span className="tabular">{message.length}/1000 · Included in the email.</span>}
        >
          <Textarea
            rows={3}
            maxLength={1000}
            placeholder="Hi! Join us to try the new HR assistant."
            className="min-h-20"
            {...form.register('message')}
          />
        </Field>

        {problem?.kind === 'pending' ? (
          <Callout
            tone="warning"
            title="An invitation is already pending for this address"
            action={
              problem.invitationId ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={resend.isPending}
                  onClick={() => problem.invitationId && resend.mutate(problem.invitationId)}
                >
                  <Send />
                  Resend it
                </Button>
              ) : null
            }
          >
            {problem.expiresAt ? (
              <>It expires {formatDateTime(problem.expiresAt)}. Resending issues a new link and voids the old one.</>
            ) : (
              'Resending issues a new link and voids the old one.'
            )}
          </Callout>
        ) : null}

        {problem?.kind === 'uncertain' ? (
          <OutcomeUnknown
            error={problem.error}
            title="We couldn't confirm whether the invitation was created"
            action={
              <Button size="sm" variant="secondary" loading={checking} onClick={() => void checkPending(problem.email)}>
                {checking ? null : <RefreshCw />}
                Check pending invitations
              </Button>
            }
          >
            It may exist already, and an email may have gone to {problem.email}. Check before sending again so they don't
            get two.
          </OutcomeUnknown>
        ) : null}

        {problem?.kind === 'found' ? (
          <Callout
            tone="success"
            title={`An invitation for ${problem.email} exists`}
            action={
              <Button size="sm" variant="secondary" onClick={onClose}>
                Done
              </Button>
            }
          >
            It was created {formatDateTime(problem.createdAt)} and expires {formatDateTime(problem.expiresAt)}. Email
            delivery was attempted; if it doesn't arrive, resend it from the Invitations tab.
          </Callout>
        ) : null}

        {problem?.kind === 'suspended' ? (
          <Callout
            tone="warning"
            title={`${problem.email} is a suspended member`}
            action={
              <Button asChild size="sm" variant="secondary">
                <Link
                  to={`/w/${workspace.slug}/team?status=suspended&q=${encodeURIComponent(problem.email)}`}
                  onClick={onClose}
                >
                  Find them in the Team list
                </Link>
              </Button>
            }
          >
            An invitation can't lift a suspension. Reactivate them from the Team list instead.
          </Callout>
        ) : null}

        <RateLimitNotice
          until={rateLimitedUntil}
          message="Too many invitation emails for now."
          onDone={() => setRateLimitedUntil(null)}
        />
        <FormError message={errors.root?.server?.message} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={isSubmitting}
          disabled={
            !!rateLimitedUntil ||
            (!rolesUnavailable && !roleId) ||
            problem?.kind === 'uncertain' ||
            problem?.kind === 'found' ||
            checking
          }
        >
          {isSubmitting ? null : <Send />}
          Send invitation
        </Button>
      </DialogFooter>
    </form>
  );
}
