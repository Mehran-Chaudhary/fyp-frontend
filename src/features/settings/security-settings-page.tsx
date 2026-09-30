import { useQuery } from '@tanstack/react-query';
import { AtSign, MailCheck, ShieldCheck, Smartphone } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { TagInput } from '@/components/ui/tag-input';
import { isApiError } from '@/lib/api/errors';
import type { Organization } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, mfaQuery, workspaceDetailsQuery } from '@/lib/queries';
import { toast, toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { domainProblem, MAX_ALLOWED_DOMAINS, normaliseDomain } from '@/lib/workspace/domains';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { IpAllowlistCard } from './ip-allowlist-card';
import { useUpdateWorkspace } from './use-update-workspace';

/** Settings → Security (spec §5.8). */
export function SecuritySettingsPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Security settings');
  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: can('workspace:read') });

  if (!can('workspace:read')) {
    return (
      <Card>
        <NoAccessState permissions={['workspace:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  if (details.isPending) {
    return (
      <div className="grid gap-6" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-48 rounded-xl" />
        ))}
      </div>
    );
  }
  if (details.isError) {
    return (
      <Card>
        <ErrorState error={details.error} title="We couldn't load the security settings" onRetry={() => void details.refetch()} retrying={details.isFetching} />
      </Card>
    );
  }

  const organization = details.data;
  const domains = organization.settings.allowedEmailDomains ?? [];
  return (
    <div className="grid gap-6">
      <RequirementsCard organization={organization} />
      <DomainsCard key={`domains:${domains.join(',')}`} organization={organization} />
      {can('security:read') ? (
        <IpAllowlistCard organization={organization} />
      ) : (
        <Card>
          <CardHeader title="IP allowlist" description="Limit which networks can reach this workspace." />
          <CardBody>
            <p className="text-[13px] text-muted">
              Your role can't view the allowlist. It needs <code className="font-mono text-[12px]">security:read</code>.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ── Two-step verification and verified email ─────────────────────────────────

function RequirementsCard({ organization }: { organization: Organization }) {
  const workspace = useWorkspace();
  const can = useCan();
  const mfa = useQuery(mfaQuery);
  const { data: me } = useQuery(meQuery);
  const [pending, setPending] = useState<{ kind: 'mfa' | 'email'; enable: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useUpdateWorkspace();

  const requireMfa = !!organization.settings.requireMfa;
  const requireEmail = !!organization.settings.requireVerifiedEmail;
  const canUpdate = can('workspace:update');
  const canMfa = canUpdate && can('security:update');
  const sessionVerified = !!mfa.data?.sessionVerified;
  const emailVerified = !!me?.emailVerified;
  const next = `/w/${workspace.slug}/settings/security`;

  const apply = (kind: 'mfa' | 'email', enable: boolean) => {
    setError(null);
    save.mutate(kind === 'mfa' ? { settings: { requireMfa: enable } } : { settings: { requireVerifiedEmail: enable } }, {
      onSuccess: () => {
        setPending(null);
        toast.success(
          kind === 'mfa'
            ? enable
              ? 'Two-step verification is now required'
              : 'Two-step verification is optional again'
            : enable
              ? 'A verified email is now required'
              : 'A verified email is optional again',
        );
      },
      onError: (err) => {
        const message =
          isApiError(err) && err.code === 'MFA_REQUIRED'
            ? 'Verify your own session with two-step verification before requiring it of the workspace.'
            : isApiError(err) && err.code === 'ACCOUNT_EMAIL_NOT_VERIFIED'
              ? 'Verify your own email address before requiring it of the workspace.'
              : messageFor(err);
        if (pending) setError(message);
        else toastError(err, "Couldn't change the requirement");
        if (isApiError(err) && err.code === 'MFA_REQUIRED') void mfa.refetch();
      },
    });
  };

  const request = (kind: 'mfa' | 'email', enable: boolean) => {
    setError(null);
    // Turning a requirement on locks people out, so confirm it; turning it off doesn't.
    if (enable) setPending({ kind, enable });
    else apply(kind, false);
  };

  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck />}
        title="Sign-in requirements"
        description="What every member needs before they can open this workspace."
      />
      <div className="border-t border-line">
        <RequirementRow
          icon={<Smartphone />}
          title="Require two-step verification"
          description="Members without two-step verification are locked out until they turn it on and sign in again."
          checked={requireMfa}
          onChange={(enable) => request('mfa', enable)}
          busy={save.isPending && save.variables?.settings?.requireMfa !== undefined}
          disabled={!canMfa || (!requireMfa && (mfa.isPending || !sessionVerified))}
          note={
            !canMfa ? (
              <>
                Needs <code className="font-mono text-[11.5px]">workspace:update</code> and{' '}
                <code className="font-mono text-[11.5px]">security:update</code>.
              </>
            ) : !requireMfa && mfa.data && !sessionVerified ? (
              <>
                {mfa.data.enabled
                  ? "Your current session wasn't verified with a code. Sign out and back in with your authenticator first."
                  : 'Turn on two-step verification for your own account first.'}{' '}
                {mfa.data.enabled ? null : (
                  <Link to={`/account/security?next=${encodeURIComponent(next)}`} className="font-medium text-brand-700 underline underline-offset-4">
                    Set it up
                  </Link>
                )}
              </>
            ) : null
          }
        />
        <RequirementRow
          icon={<MailCheck />}
          title="Require a verified email address"
          description="Members who haven't verified their email are locked out until they do."
          checked={requireEmail}
          onChange={(enable) => request('email', enable)}
          busy={save.isPending && save.variables?.settings?.requireVerifiedEmail !== undefined}
          disabled={!canUpdate || (!requireEmail && !emailVerified)}
          note={
            !canUpdate ? (
              <>
                Needs <code className="font-mono text-[11.5px]">workspace:update</code>.
              </>
            ) : !requireEmail && me && !emailVerified ? (
              'Verify your own email address first. The link is in your inbox; you can resend it from the banner above.'
            ) : null
          }
        />
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        icon={pending?.kind === 'mfa' ? <Smartphone /> : <MailCheck />}
        tone="warning"
        title={pending?.kind === 'mfa' ? 'Require two-step verification?' : 'Require a verified email address?'}
        description={
          pending?.kind === 'mfa'
            ? 'Members without two-step verification will be locked out of this workspace until they turn it on and sign in again.'
            : "Members who haven't verified their email will be locked out of this workspace until they do."
        }
        confirmLabel="Require it"
        pending={save.isPending}
        error={error}
        onConfirm={() => pending && apply(pending.kind, true)}
      />
    </Card>
  );
}

function RequirementRow({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
  busy,
  note,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  note?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-4 border-t border-line/70 px-5 py-4 first:border-t-0 sm:px-6">
      <span className="mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-well text-ink-soft sm:inline-flex [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-ink">
          {title}
          {checked ? <Badge tone="brand">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
        </label>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>
        {note ? <p className="mt-2 text-xs leading-relaxed text-warning-700">{note}</p> : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled || busy}
        className={cn('mt-0.5', busy && 'animate-pulse')}
      />
    </div>
  );
}

// ── Allowed email domains ───────────────────────────────────────────────────

function DomainsCard({ organization }: { organization: Organization }) {
  const can = useCan();
  const editable = can('workspace:update');
  const initial = (organization.settings.allowedEmailDomains ?? []).map(normaliseDomain).filter(Boolean);
  const [domains, setDomains] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useUpdateWorkspace();
  const dirty = domains.join('\n') !== initial.join('\n');

  const submit = () => {
    setError(null);
    save.mutate(
      // [] removes the restriction.
      { settings: { allowedEmailDomains: domains } },
      {
        onSuccess: () =>
          toast.success(domains.length ? 'Allowed domains saved' : 'Invitations can go to any domain again'),
        onError: (err) => {
          if (isApiError(err) && err.code === 'VALIDATION_FAILED') {
            const fields = err.fieldErrors({ fields: ['settings.allowedEmailDomains'] });
            setError(fields['settings.allowedEmailDomains'] ?? fields._form ?? err.message);
          } else {
            setError(messageFor(err));
          }
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        icon={<AtSign />}
        title="Allowed email domains"
        description="Invitations can only be sent to addresses at these domains. Existing members are not affected."
      />
      <CardBody>
        <Field
          label="Domains"
          error={error ?? undefined}
          hint={
            domains.length === 0
              ? 'Empty means invitations can go to any domain.'
              : `Only exact matches: "acme.com" doesn't allow "mail.acme.com". Up to ${MAX_ALLOWED_DOMAINS}.`
          }
        >
          <TagInput
            value={domains}
            onChange={(next) => {
              setDomains(next);
              setError(null);
            }}
            normalize={normaliseDomain}
            validate={domainProblem}
            max={MAX_ALLOWED_DOMAINS}
            placeholder={editable ? 'acme.com, example.org' : 'Any domain'}
            disabled={!editable}
            mono
          />
        </Field>
      </CardBody>
      {editable ? (
        <CardFooter>
          <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setDomains(initial)}>
            Discard
          </Button>
          <Button disabled={!dirty} loading={save.isPending} onClick={submit}>
            Save domains
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
