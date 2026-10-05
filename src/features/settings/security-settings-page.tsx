import { useQuery } from '@tanstack/react-query';
import { ArrowRight, AtSign, MailCheck, RotateCcw, ShieldCheck, Smartphone } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { TagInput } from '@/components/ui/tag-input';
import { isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { Organization, OrganizationSettingsPatch } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, mfaQuery } from '@/lib/queries';
import { diffKeys } from '@/lib/rbac/grants';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { domainProblem, MAX_ALLOWED_DOMAINS, normaliseDomain } from '@/lib/workspace/domains';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { useUpdateWorkspace } from './use-update-workspace';
import { ReadOnlyHint, WorkspaceDetailsGate } from './workspace-details-gate';

/** Settings → Security (spec §4 `/settings/security`): sign-in requirements and invitation domains. */
export function SecuritySettingsPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Security settings');
  return (
    <WorkspaceDetailsGate what="the security settings" skeleton={[16, 10]}>
      {(organization) => {
        const domains = organization.settings.allowedEmailDomains ?? [];
        return (
          <div className="grid grid-cols-1 gap-6">
            <RequirementsCard organization={organization} />
            <DomainsCard key={`domains:${domains.join(',')}`} organization={organization} />
            {can('security:read') ? (
              <Link
                to={`/w/${workspace.slug}/settings/networks`}
                className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-4 text-[13px] shadow-card transition-colors hover:border-line-strong sm:px-6"
              >
                <span>
                  <span className="font-medium text-ink">Network restrictions</span>
                  <span className="mt-0.5 block text-muted">IP allowlist rules and enforcement live under Networks.</span>
                </span>
                <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        );
      }}
    </WorkspaceDetailsGate>
  );
}

// ── Two-step verification and verified email ─────────────────────────────────

type PolicyKey = 'requireMfa' | 'requireVerifiedEmail';
/** true / false = a workspace override; null = remove the override (deployment default). */
type PolicyChange = { key: PolicyKey; value: boolean | null };

const POLICY: Record<PolicyKey, { title: string; on: string; off: string; icon: ReactNode }> = {
  requireMfa: {
    title: 'Two-step verification',
    on: 'Members whose current session wasn’t verified with two-step verification are refused until they set it up and sign in again with a code. API keys are not affected.',
    off: 'Members can open the workspace without two-step verification.',
    icon: <Smartphone />,
  },
  requireVerifiedEmail: {
    title: 'Verified email address',
    on: 'Members who haven’t verified their email address are refused until they do.',
    off: 'Members can open the workspace before verifying their email address.',
    icon: <MailCheck />,
  },
};

function describeValue(value: boolean | null | undefined): string {
  if (value === true) return 'Required';
  if (value === false) return 'Not required';
  return 'Deployment default';
}

function RequirementsCard({ organization }: { organization: Organization }) {
  const can = useCan();
  const mfa = useQuery(mfaQuery);
  const { data: me } = useQuery(meQuery);
  const workspace = useWorkspace();
  const [pending, setPending] = useState<PolicyChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const save = useUpdateWorkspace();

  const settings = organization.settings;
  const canUpdate = can('workspace:update');
  // Any requireMfa value, null included, also needs security:update (spec §3).
  const canMfa = canUpdate && can('security:update');
  const sessionVerified = !!mfa.data?.sessionVerified;
  const emailVerified = !!me?.emailVerified;
  const next = `/w/${workspace.slug}/settings/security`;

  const apply = (change: PolicyChange) => {
    setError(null);
    setUncertain(null);
    const patch: OrganizationSettingsPatch = { [change.key]: change.value };
    save.mutate(
      { settings: patch },
      {
        onSuccess: () => {
          setPending(null);
          toast.success(`${POLICY[change.key].title}: ${describeValue(change.value).toLowerCase()}`, {
            description: 'Applies to the next request each member makes.',
          });
        },
        onError: (err) => {
          if (isOutcomeUnknown(err)) {
            setPending(null);
            setUncertain(err);
            return;
          }
          if (isApiError(err) && err.code === 'MFA_REQUIRED') {
            setError('Your current session wasn’t verified with two-step verification. Sign in again with your authenticator, then try again.');
            void mfa.refetch();
          } else if (isApiError(err) && err.code === 'ACCOUNT_EMAIL_NOT_VERIFIED') {
            setError('Verify your own email address before requiring it of the workspace.');
          } else {
            setError(messageFor(err));
          }
        },
      },
    );
  };

  const request = (change: PolicyChange) => {
    setError(null);
    setPending(change);
  };

  const mfaBlocked = !canMfa ? 'permission' : !mfa.data ? 'loading' : !sessionVerified ? 'session' : null;
  const emailBlocked = !canUpdate ? 'permission' : !me ? 'loading' : !emailVerified ? 'email' : null;

  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck />}
        title="Sign-in requirements"
        description="What every member's session needs before this workspace answers it."
      />
      <div className="border-t border-line">
        <RequirementRow
          policyKey="requireMfa"
          value={settings.requireMfa}
          // Turning it on needs a verified session; turning it off or resetting doesn't.
          canEnable={mfaBlocked === null}
          canChange={canMfa}
          busy={save.isPending && pending?.key === 'requireMfa'}
          onRequest={request}
          note={
            mfaBlocked === 'permission' ? (
              <>
                Changing this needs <code className="font-mono text-[11.5px]">workspace:update</code> and{' '}
                <code className="font-mono text-[11.5px]">security:update</code>.
              </>
            ) : mfaBlocked === 'session' && settings.requireMfa !== true ? (
              <>
                {mfa.data?.enabled
                  ? 'To turn this on, your own session must be verified with a code: sign out and back in with your authenticator.'
                  : 'To turn this on, set up two-step verification for your own account and sign in with it.'}{' '}
                {mfa.data?.enabled ? null : (
                  <Link to={`/account/security?next=${encodeURIComponent(next)}`} className="font-medium text-brand-700 underline underline-offset-4">
                    Set it up
                  </Link>
                )}
              </>
            ) : null
          }
        />
        <RequirementRow
          policyKey="requireVerifiedEmail"
          value={settings.requireVerifiedEmail}
          canEnable={emailBlocked === null}
          canChange={canUpdate}
          busy={save.isPending && pending?.key === 'requireVerifiedEmail'}
          onRequest={request}
          note={
            emailBlocked === 'permission' ? (
              <>
                Changing this needs <code className="font-mono text-[11.5px]">workspace:update</code>.
              </>
            ) : emailBlocked === 'email' && settings.requireVerifiedEmail !== true ? (
              'To turn this on, verify your own email address first. You can resend the link from the banner at the top.'
            ) : null
          }
        />
      </div>
      {uncertain ? (
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <OutcomeUnknown error={uncertain}>
            The policy change may have been saved. The switches are being re-read from the server; check them before
            trying again.
          </OutcomeUnknown>
        </div>
      ) : null}

      <PolicyReviewDialog
        change={pending}
        current={pending ? settings[pending.key] : undefined}
        pending={save.isPending}
        error={error}
        onCancel={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={() => pending && apply(pending)}
      />
    </Card>
  );
}

function RequirementRow({
  policyKey,
  value,
  canEnable,
  canChange,
  busy,
  onRequest,
  note,
}: {
  policyKey: PolicyKey;
  value: boolean | undefined;
  canEnable: boolean;
  canChange: boolean;
  busy: boolean;
  onRequest: (change: PolicyChange) => void;
  note?: ReactNode;
}) {
  const id = useId();
  const policy = POLICY[policyKey];
  const on = value === true;
  const overridden = value !== undefined;
  return (
    <div className="flex items-start gap-4 border-t border-line/70 px-5 py-4 first:border-t-0 sm:px-6">
      <span className="mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-well text-ink-soft sm:inline-flex [&_svg]:size-4">
        {policy.icon}
      </span>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-ink">
          Require {policy.title.toLowerCase()}
          <Badge tone={on ? 'brand' : 'neutral'}>{describeValue(value)}</Badge>
        </label>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{on ? policy.on : policy.off}</p>
        {note ? <p className="mt-2 text-xs leading-relaxed text-warning-700">{note}</p> : null}
        {overridden && canChange ? (
          <button
            type="button"
            onClick={() => onRequest({ key: policyKey, value: null })}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
          >
            <RotateCcw className="size-3" aria-hidden />
            Reset to the deployment default
          </button>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={on}
        onCheckedChange={(next) => onRequest({ key: policyKey, value: next })}
        disabled={!canChange || busy || (!on && !canEnable)}
        className={cn('mt-0.5', busy && 'animate-pulse')}
      />
    </div>
  );
}

/** The review every policy change goes through: old value, new value, who it affects (spec §4). */
function PolicyReviewDialog({
  change,
  current,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  change: PolicyChange | null;
  current: boolean | undefined;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const policy = change ? POLICY[change.key] : null;
  const tightening = change?.value === true;
  return (
    <ConfirmDialog
      open={change !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      icon={policy?.icon}
      tone={tightening ? 'warning' : 'neutral'}
      size="md"
      title={policy ? `Change “Require ${policy.title.toLowerCase()}”?` : ''}
      description="Review the change. It applies to every member's next request."
      confirmLabel={change?.value === null ? 'Reset to default' : tightening ? 'Require it' : 'Make it optional'}
      pending={pending}
      error={error}
      onConfirm={onConfirm}
    >
      {change && policy ? (
        <div className="grid gap-3">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border border-line bg-well/40 px-4 py-3 text-[13px]">
            <dt className="text-muted">Now</dt>
            <dd className="font-medium text-ink">{describeValue(current)}</dd>
            <dt className="text-muted">After</dt>
            <dd className="font-medium text-ink">{describeValue(change.value)}</dd>
          </dl>
          <p className="text-[13px] leading-relaxed text-muted">
            {change.value === true
              ? policy.on
              : change.value === false
                ? policy.off
                : 'The workspace stops overriding this; whatever the deployment is configured with applies.'}
          </p>
          {tightening ? (
            <Callout tone="warning">
              People who don't meet it lose access at once, including administrators. Existing invitations aren't
              re-checked; the requirement applies when the person tries to open the workspace.
            </Callout>
          ) : null}
        </div>
      ) : null}
    </ConfirmDialog>
  );
}

// ── Allowed email domains ───────────────────────────────────────────────────

function DomainsCard({ organization }: { organization: Organization }) {
  const can = useCan();
  const editable = can('workspace:update');
  const initial = (organization.settings.allowedEmailDomains ?? []).map(normaliseDomain).filter(Boolean);
  const [domains, setDomains] = useState<string[]>(initial);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const save = useUpdateWorkspace();
  const diff = diffKeys(initial, domains);
  const dirty = diff.added.length > 0 || diff.removed.length > 0;

  const submit = () => {
    setError(null);
    setUncertain(null);
    save.mutate(
      // Bare, lowercased domains; [] removes the restriction.
      { settings: { allowedEmailDomains: domains } },
      {
        onSuccess: () => {
          setReviewing(false);
          toast.success(domains.length ? 'Allowed domains saved' : 'Invitations can go to any domain again');
        },
        onError: (err) => {
          if (isOutcomeUnknown(err)) {
            setReviewing(false);
            setUncertain(err);
          } else if (isApiError(err) && err.code === 'VALIDATION_FAILED') {
            const fields = err.fieldErrors({ fields: ['settings.allowedEmailDomains'] });
            const message = Object.entries(fields).find(([key]) => key.startsWith('settings.allowedEmailDomains'))?.[1];
            setError(message ?? fields._form ?? err.message);
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
        description="New invitations can only go to addresses at these domains. Existing members are not affected."
      />
      <CardBody className="grid gap-3">
        <Field
          label="Domains"
          error={reviewing ? undefined : (error ?? undefined)}
          hint={
            domains.length === 0
              ? 'Empty means invitations can go to any domain.'
              : `Exact matches only: “acme.com” doesn't allow “mail.acme.com”. Up to ${MAX_ALLOWED_DOMAINS}.`
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
        {uncertain ? (
          <OutcomeUnknown error={uncertain}>
            The domains may have been saved. They're being re-read from the server; check them before saving again.
          </OutcomeUnknown>
        ) : null}
      </CardBody>
      <CardFooter className={editable ? undefined : 'justify-start'}>
        {editable ? (
          <>
            <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setDomains(initial)}>
              Discard
            </Button>
            <Button
              disabled={!dirty}
              onClick={() => {
                setError(null);
                setReviewing(true);
              }}
            >
              Review and save
            </Button>
          </>
        ) : (
          <ReadOnlyHint />
        )}
      </CardFooter>

      <ConfirmDialog
        open={reviewing}
        onOpenChange={(open) => {
          if (!open) setReviewing(false);
        }}
        icon={<AtSign />}
        tone="neutral"
        size="md"
        title="Save allowed domains?"
        description={domains.length ? 'New invitations will only be accepted for these exact domains.' : 'Invitations will be allowed to any domain.'}
        confirmLabel="Save domains"
        pending={save.isPending}
        error={error}
        onConfirm={submit}
      >
        <div className="grid gap-3 text-[13px]">
          {diff.added.length ? <DomainList label="Added" tone="brand" domains={diff.added} /> : null}
          {diff.removed.length ? <DomainList label="Removed" tone="neutral" domains={diff.removed} /> : null}
          <p className="leading-relaxed text-muted">
            Invitations already sent aren't re-checked against the new list: revoke any you no longer want from Team →
            Invitations.
          </p>
        </div>
      </ConfirmDialog>
    </Card>
  );
}

function DomainList({ label, tone, domains }: { label: string; tone: 'brand' | 'neutral'; domains: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <ul className="flex flex-wrap gap-1.5">
        {domains.map((domain) => (
          <li key={domain}>
            <Badge tone={tone} className={cn(tone === 'neutral' && 'line-through')}>
              <span className="font-mono">{domain}</span>
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
