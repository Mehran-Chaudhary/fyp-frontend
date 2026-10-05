import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Crown, KeyRound, Lock, SearchCheck, Users } from 'lucide-react';
import { useState, type ChangeEvent, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardFooter } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { WorkspaceTile } from '@/components/ui/misc';
import { organizationsApi } from '@/lib/api/endpoints';
import { isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import { workspaceHref } from '@/lib/auth/landing';
import { applyServerErrors, messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, queryKeys, workspacesQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { timestamp } from '@/lib/utils';
import { slugPreview, slugify } from '@/lib/validation/slug';
import { workspaceDescriptionField, workspaceNameField, workspaceSlugField } from '@/lib/validation/schemas';

const schema = z.object({
  name: workspaceNameField,
  slug: workspaceSlugField,
  description: workspaceDescriptionField,
});
type Values = z.infer<typeof schema>;

/** A create request that got no answer: it may or may not have happened. */
interface Uncertain {
  name: string;
  slug: string;
  sentAt: number;
}

/**
 * Create a workspace (P1-API-21). The creator becomes its owner. The returned id
 * and slug are the truth: the server may add a suffix to a taken slug. A request
 * without an answer is never repeated blindly; the user checks first.
 */
export function CreateWorkspacePage() {
  useDocumentTitle('Create workspace');
  const navigate = useNavigate();
  const { data: me } = useQuery(meQuery);
  const [slugEdited, setSlugEdited] = useState(false);
  const [limit, setLimit] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<Uncertain | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const isFirst = (me?.memberships.length ?? 0) === 0;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', slug: '', description: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const [name, slug, description] = useWatch({ control: form.control, name: ['name', 'slug', 'description'] });
  const host = typeof window !== 'undefined' ? window.location.host : '';

  const nameField = form.register('name', {
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      if (!slugEdited) form.setValue('slug', slugPreview(event.target.value), { shouldValidate: form.formState.isSubmitted });
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (uncertain) return;
    setCheckResult(null);
    const sentAt = timestamp();
    try {
      const created = await organizationsApi.create({
        name: values.name,
        ...(values.slug ? { slug: values.slug } : {}),
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
      });
      // The creator becomes the owner; refresh memberships before entering so the
      // gate finds it straight away. Always use the RETURNED slug: the server
      // appends a suffix when the requested one is taken.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
      ]);
      const requested = values.slug || slugPreview(values.name);
      if (requested && created.slug !== requested) {
        toast.info('Workspace created', { description: `/w/${requested} was taken, so its address is /w/${created.slug}.` });
      } else {
        toast.success('Workspace created', { description: `You're the owner of ${created.name}.` });
      }
      navigate(workspaceHref(created), { replace: true });
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        setUncertain({ name: values.name.trim(), slug: values.slug || slugPreview(values.name), sentAt });
        return;
      }
      if (!isApiError(error)) {
        form.setError('root.server', { message: messageFor(error) });
        return;
      }
      switch (error.code) {
        case 'ORGANIZATION_SLUG_RESERVED':
          form.setError('slug', { message: 'That URL is reserved.' }, { shouldFocus: true });
          break;
        case 'ORGANIZATION_SLUG_TAKEN':
        case 'RESOURCE_CONFLICT':
          form.setError('slug', { message: 'That URL is taken. Try a different one.' }, { shouldFocus: true });
          break;
        case 'ORGANIZATION_LIMIT_REACHED':
          setLimit(messageFor(error));
          break;
        default:
          applyServerErrors(form, error, { fields: ['name', 'slug', 'description'] });
      }
    }
  });

  /** Looks for the workspace among yours (newest membership first). */
  const checkCreated = async () => {
    if (!uncertain) return;
    setChecking(true);
    try {
      const firstPage = await queryClient.fetchQuery({ ...workspacesQuery(1), staleTime: 0 });
      const found = firstPage.items.find(
        (workspace) =>
          workspace.isOwner &&
          Date.parse(workspace.createdAt) >= uncertain.sentAt - 60_000 &&
          (workspace.name === uncertain.name ||
            (!!uncertain.slug && (workspace.slug === uncertain.slug || workspace.slug.startsWith(`${uncertain.slug}-`)))),
      );
      if (found) {
        await queryClient.refetchQueries({ queryKey: queryKeys.me });
        toast.success('Workspace created', { description: `${found.name} was created after all.` });
        navigate(workspaceHref(found), { replace: true });
        return;
      }
      setUncertain(null);
      setCheckResult(`${uncertain.name} wasn't created. You can create it now.`);
    } catch (error) {
      setCheckResult(`We still can't tell: ${messageFor(error)}`);
    } finally {
      setChecking(false);
    }
  };

  const previewSlug = slug || slugify(name ?? '') || 'your-workspace';

  return (
    <div className="grid gap-8">
      {isFirst ? null : (
        <Link
          to="/workspaces"
          className="-mb-4 inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          All workspaces
        </Link>
      )}
      <PageHeader
        title={isFirst ? 'Create your first workspace' : 'Create a workspace'}
        description={
          isFirst
            ? "A workspace holds your team's agents, documents and workflows. You can create more later or be invited to others."
            : 'A new, isolated tenant. Nothing is shared with your other workspaces.'
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <form onSubmit={onSubmit} noValidate>
            <CardBody className="grid gap-5 pt-6">
              {limit ? (
                <Callout tone="warning" title="Workspace limit reached">
                  {limit} Delete one you own, or ask to be invited to an existing workspace.
                </Callout>
              ) : null}
              {uncertain ? (
                <Callout
                  tone="warning"
                  title="We couldn't confirm whether it was created"
                  action={
                    <Button size="sm" variant="secondary" loading={checking} onClick={() => void checkCreated()}>
                      {checking ? null : <SearchCheck />}
                      Check my workspaces
                    </Button>
                  }
                >
                  The connection dropped before AgentVault answered, so {uncertain.name} may already exist. Check before
                  trying again, so you don't end up with two.
                </Callout>
              ) : checkResult ? (
                <Callout tone="info" role="status">
                  {checkResult}
                </Callout>
              ) : null}
              <fieldset disabled={!!limit} className="grid gap-5 disabled:opacity-60">
                <Field label="Workspace name" error={errors.name?.message}>
                  <Input autoFocus placeholder="Acme Corporation" maxLength={120} {...nameField} />
                </Field>
                <Field
                  label="URL"
                  optional
                  error={errors.slug?.message}
                  hint="Lowercase letters, numbers and hyphens. Leave empty to generate one. It can't be changed later."
                >
                  <Input
                    addon={`${host}/w/`}
                    placeholder={slugify(name ?? '') || 'acme-corp'}
                    maxLength={60}
                    spellCheck={false}
                    autoCapitalize="off"
                    inputClassName="font-mono text-[13px]"
                    {...form.register('slug', {
                      onChange: (event: ChangeEvent<HTMLInputElement>) => {
                        setSlugEdited(event.target.value !== '');
                        form.setValue('slug', event.target.value.toLowerCase().replace(/\s+/g, '-'));
                      },
                    })}
                  />
                </Field>
                <Field
                  label="Description"
                  optional
                  error={errors.description?.message}
                  hint={<span className="tabular">{(description ?? '').length} / 2000</span>}
                >
                  <Textarea
                    rows={3}
                    maxLength={2000}
                    placeholder="What will this workspace be used for?"
                    {...form.register('description')}
                  />
                </Field>
              </fieldset>
              <FormError message={errors.root?.server?.message} />
            </CardBody>
            <CardFooter className="justify-between">
              <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
                <WorkspaceTile name={name || 'Workspace'} seed={previewSlug} size="sm" />
                <span className="truncate font-mono">/w/{previewSlug}</span>
              </p>
              <Button type="submit" loading={isSubmitting} disabled={!!limit || !!uncertain}>
                Create workspace
                {isSubmitting ? null : <ArrowRight />}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <aside className="rounded-xl border border-line bg-well/50 p-5">
          <h2 className="text-[13px] font-semibold text-ink">What you get</h2>
          <ul className="mt-4 grid gap-4">
            <Perk icon={<Crown />} title="You're the owner">
              Full control, including who else can manage the workspace.
            </Perk>
            <Perk icon={<KeyRound />} title="Four built-in roles">
              Owner, Admin, Member and Viewer, plus custom roles later.
            </Perk>
            <Perk icon={<Lock />} title="Strict isolation">
              Documents, agents and audit logs stay inside this workspace.
            </Perk>
            <Perk icon={<Users />} title="Invite your team">
              Team invitations arrive with workspace administration.
            </Perk>
          </ul>
        </aside>
      </div>
    </div>
  );
}

function Perk({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-soft [&_svg]:size-3.5">
        {icon}
      </span>
      <p className="text-[13px] leading-relaxed text-muted">
        <span className="block font-medium text-ink">{title}</span>
        {children}
      </p>
    </li>
  );
}
