import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, MailPlus, ShieldOff, Send } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { invitationsApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { Role } from '@/lib/api/types';
import { applyServerErrors, detailList, messageFor } from '@/lib/errors';
import { queryKeys, rolesQuery, workspaceDetailsQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { grantableRoles } from '@/lib/rbac/rules';
import { toast, toastError } from '@/lib/toast';
import { formatDate, formatDateTime } from '@/lib/utils';
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

/** "Invite people" (spec §5.3). */
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
  | { kind: 'suspended'; email: string };

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
      toast.success('Invitation resent', {
        description: `A new link went to ${invitation.email}. It expires ${formatDate(invitation.expiresAt)}.`,
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
      toast.success(`Invitation sent to ${invitation.email}`, {
        description: `They'll join as ${invitation.role?.name ?? 'a member'} and have until ${formatDate(invitation.expiresAt)} to accept.`,
      });
      void invalidateInvitations(workspace.id);
      onBusyChange(false);
      onClose();
    } catch (error) {
      onBusyChange(false);
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
          setRoleError(
            denied.length
              ? `You can't invite into this role: it grants ${denied.join(', ')}, which you don't hold.`
              : `You can't invite into this role. ${error.message}`,
          );
          break;
        }
        case 'SEAT_LIMIT_REACHED':
          form.setError('root.server', { message: messageFor(error) });
          break;
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

  const header = (
    <DialogHeader
      icon={<MailPlus />}
      title={`Invite people to ${workspace.name}`}
      description="They'll get an email with a link that's valid for 7 days."
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
            {...form.register('email', { onChange: () => setProblem(null) })}
          />
        </Field>

        {rolesUnavailable ? (
          <Callout tone="neutral">They'll join with this workspace's default role.</Callout>
        ) : (
          <Field
            label="Role"
            error={roleError ?? undefined}
            hint="You can only offer roles that rank below yours and whose permissions you hold."
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
          message="Too many invitations to this address."
          onDone={() => setRateLimitedUntil(null)}
        />
        <FormError message={errors.root?.server?.message} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting} disabled={!!rateLimitedUntil || (!rolesUnavailable && !roleId)}>
          {isSubmitting ? null : <Send />}
          Send invitation
        </Button>
      </DialogFooter>
    </form>
  );
}
