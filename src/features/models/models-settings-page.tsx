import { useMutation, useQuery } from '@tanstack/react-query';
import { Cpu, Gauge, RotateCcw, Save, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardFooter, CardHeader, DetailRow } from '@/components/ui/card';
import { CheckboxBox } from '@/components/ui/checkbox';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { llmApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { LlmModel, LlmPolicy } from '@/lib/api/types';
import { afterLlmPolicyUpdated } from '@/lib/agents/cache';
import {
  choosableModels,
  draftFromLlmPolicy,
  llmPolicyPatch,
  rebaseLlmPolicyDraft,
  removedModels,
  validateLlmPolicyDraft,
  type LlmPolicyDraft,
} from '@/lib/agents/llm-policy';
import { formatBytes } from '@/lib/knowledge/files';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { llmModelsQuery, llmPolicyQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { ClassificationBadge } from '@/features/knowledge/shared/badges';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';

/** Settings → Models (§4.3, §5.8; P4-API-22/23/24). */
export function ModelsSettingsPage() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  useDocumentTitle('Models');
  if (!can.readModels) {
    return (
      <Card>
        <NoAccessState permissions={['llm:invoke', 'llm:manage', 'agent:read']} workspaceName={workspace.name} title="You can't see the models" />
      </Card>
    );
  }
  return <Models />;
}

function Models() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const models = useQuery(llmModelsQuery(workspace.id));
  const policy = useQuery(llmPolicyQuery(workspace.id));

  return (
    <div className="grid grid-cols-1 gap-6">
      {policy.isPending ? (
        <Skeleton className="h-56 w-full rounded-xl" />
      ) : policy.isError ? (
        <Card>
          <ErrorState error={policy.error} title="We couldn't load the model policy" onRetry={() => void policy.refetch()} retrying={policy.isFetching} />
        </Card>
      ) : (
        <EffectiveLimits policy={policy.data} />
      )}

      <Card className="overflow-hidden">
        <CardHeader
          title="Model catalogue"
          icon={<Cpu />}
          description="What the model server offers, and whether this workspace may use it."
          actions={models.data ? <span className="text-xs text-faint">{pluralize(models.data.models.length, 'model')}</span> : null}
        />
        {models.data && !models.data.verified ? (
          <div className="px-5 pb-4 sm:px-6">
            <Callout tone="warning" title="Couldn't confirm with the model server">
              This list comes from configuration. The server may serve other models, or be down.
            </Callout>
          </div>
        ) : null}
        {models.isPending ? (
          <div className="px-6 pb-6">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : models.isError ? (
          <ErrorState compact error={models.error} onRetry={() => void models.refetch()} retrying={models.isFetching} />
        ) : (
          <ModelTable models={models.data.models} />
        )}
      </Card>

      {policy.data && models.data ? (
        can.manageModelPolicy ? (
          <PolicyEditor policy={policy.data} models={models.data.models} />
        ) : (
          <p className="text-[13px] text-muted">Changing which models this workspace may use needs the llm:manage permission.</p>
        )
      ) : null}
    </div>
  );
}

function EffectiveLimits({ policy }: { policy: LlmPolicy }) {
  const effective = policy.effective;
  return (
    <Card>
      <CardHeader
        title="What requests get"
        icon={<Gauge />}
        description={
          policy.source === 'default'
            ? 'This workspace uses the platform defaults: no policy has been saved yet.'
            : `This workspace's policy, version ${policy.version}, on top of the platform's limits.`
        }
      />
      <CardBody>
        <dl className="divide-y divide-line/70">
          <DetailRow label="Default model">
            <span className="font-mono text-[12.5px]">{effective.defaultModel}</span>
          </DetailRow>
          <DetailRow label="Longest answer">{effective.maxOutputTokens.toLocaleString()} tokens</DetailRow>
          <DetailRow label="Largest context window">{effective.maxContextTokens.toLocaleString()} tokens</DetailRow>
          <DetailRow label="Platform allowlist">
            {effective.platformAllowlist.length ? (
              <span className="font-mono text-[12px] break-all">{effective.platformAllowlist.join(', ')}</span>
            ) : (
              'Unrestricted'
            )}
          </DetailRow>
          <DetailRow label="Model endpoint ceiling">
            <ClassificationBadge classification={effective.maxClassification} withTooltip />
          </DetailRow>
        </dl>
        <p className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-snug text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
          {effective.maxClassification === 'RESTRICTED'
            ? 'Agents may retrieve documents of any classification the person talking to them can read.'
            : `A third-party model endpoint should not receive confidential text, so no agent retrieves anything above ${effective.maxClassification.toLowerCase()}, for anyone, the owner included. Answers can have gaps because of it.`}
        </p>
        <p className="mt-2 text-[12px] text-muted">
          A requested answer length above the ceiling is clamped, not refused. The output ceiling is also at most half the context window.
        </p>
      </CardBody>
    </Card>
  );
}

function ModelTable({ models }: { models: LlmModel[] }) {
  if (models.length === 0) return <p className="px-6 pb-6 text-[13px] text-muted">The server lists no models.</p>;
  return (
    <Table>
      <THead>
        <tr>
          <TH>Model</TH>
          <TH>Family</TH>
          <TH className="text-right">Context</TH>
          <TH>Size</TH>
          <TH>In this workspace</TH>
        </tr>
      </THead>
      <TBody>
        {models.map((model) => (
          <TR key={model.name}>
            <TD className="font-mono text-[12.5px] break-all text-ink">{model.name}</TD>
            <TD>{model.family ?? <span className="text-faint">—</span>}</TD>
            <TD className="text-right font-mono tabular">{model.contextLength ? model.contextLength.toLocaleString() : <span className="text-faint">—</span>}</TD>
            <TD className="text-[12.5px]">
              {[model.parameterSize, model.quantization, model.sizeBytes ? formatBytes(String(model.sizeBytes)) : null].filter(Boolean).join(' · ') || <span className="text-faint">—</span>}
            </TD>
            <TD>
              <span className="flex flex-wrap gap-1">
                {model.allowed ? (
                  <Badge tone="success" dot>
                    Allowed
                  </Badge>
                ) : (
                  <Badge tone="neutral">Not allowed</Badge>
                )}
                {model.isDefault ? <Badge tone="brand">Default</Badge> : null}
              </span>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

const PLATFORM_DEFAULT = '__platform__';

function PolicyEditor({ policy, models }: { policy: LlmPolicy; models: LlmModel[] }) {
  const workspace = useWorkspace();
  const [base, setBase] = useState(policy);
  const [draft, setDraft] = useState<LlmPolicyDraft>(() => draftFromLlmPolicy(policy));
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = llmPolicyPatch(base, draft) !== null;
  // A newer policy arrived in the background: follow it unless you're mid-edit.
  const newer = policy.version !== base.version;
  if (newer && !dirty) {
    setBase(policy);
    setDraft(draftFromLlmPolicy(policy));
  }
  const names = choosableModels(models, base);
  const errors = validateLlmPolicyDraft(draft);
  const patch = llmPolicyPatch(base, draft);
  const removed = patch?.allowedModels ? removedModels(base, draft, names) : [];
  const defaultChoices = draft.allowedModels.length ? draft.allowedModels : names;

  const save = useMutation({
    mutationFn: () => llmApi.updatePolicy(workspace.id, patch!),
    onSuccess: (saved) => {
      void afterLlmPolicyUpdated(workspace.id, saved);
      setBase(saved);
      setDraft(draftFromLlmPolicy(saved));
      setNotice(null);
      toast.success(`Model policy saved (version ${saved.version})`, { description: 'It applies to the next request everywhere.' });
    },
    onError: async (error) => {
      if (hasCode(error, 'RESOURCE_CONFLICT') || isOutcomeUnknown(error)) {
        try {
          const current = await queryClient.fetchQuery({ ...llmPolicyQuery(workspace.id), staleTime: 0 });
          if (isOutcomeUnknown(error) && llmPolicyPatch(current, draft) === null) {
            void afterLlmPolicyUpdated(workspace.id, current);
            setBase(current);
            setDraft(draftFromLlmPolicy(current));
            toast.success('Model policy saved');
            return;
          }
          setDraft(rebaseLlmPolicyDraft(base, current, draft));
          setBase(current);
          setNotice(
            hasCode(error, 'RESOURCE_CONFLICT')
              ? `Someone saved the policy (now version ${current.version}) while you were editing. Your changes are applied on top of theirs: review them and save again.`
              : "We couldn't confirm the save. The latest policy is loaded with your changes on top: review and save again.",
          );
        } catch (refetchError) {
          setFormError(messageFor(refetchError));
        }
        return;
      }
      setFormError(messageFor(error));
      if (hasCode(error, 'LLM_MODEL_NOT_ALLOWED')) void queryClient.invalidateQueries({ queryKey: queryKeys.llmModels(workspace.id) });
    },
  });

  const toggle = (name: string, on: boolean) =>
    setDraft((current) => {
      const allowedModels = on ? [...current.allowedModels, name].sort() : current.allowedModels.filter((item) => item !== name);
      const defaultModel = current.defaultModel && allowedModels.length && !allowedModels.includes(current.defaultModel) ? null : current.defaultModel;
      return { ...current, allowedModels, defaultModel };
    });

  return (
    <Card>
      <CardHeader
        title="Workspace model policy"
        description={`Narrow the platform's models for this workspace and lower its ceilings. ${base.source === 'workspace' ? `Version ${base.version}.` : 'Not saved yet.'}`}
      />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setFormError(null);
          if (!patch || Object.keys(errors).length) return;
          save.mutate();
        }}
      >
        <CardBody className="grid gap-5">
          {notice ? <Callout tone="warning">{notice}</Callout> : null}
          {newer && dirty ? (
            <Callout
              tone="warning"
              title="The policy changed since you opened it"
              action={
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    setDraft(rebaseLlmPolicyDraft(base, policy, draft));
                    setBase(policy);
                  }}
                >
                  Load the latest and keep my edits
                </Button>
              }
            >
              Version {policy.version} was saved by someone else.
            </Callout>
          ) : null}
          <div className="grid gap-2">
            <p className="text-[13px] font-medium text-ink-soft">Allowed models</p>
            <ul className="divide-y divide-line/70 rounded-lg border border-line">
              {names.map((name) => (
                <li key={name}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-well/40">
                    <CheckboxBox checked={draft.allowedModels.includes(name)} onCheckedChange={(on) => toggle(name, on)} aria-label={name} className="mt-0" />
                    <span className="font-mono text-[12.5px] break-all text-ink-soft">{name}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] text-muted">
              {draft.allowedModels.length ? `${pluralize(draft.allowedModels.length, 'model')} allowed.` : 'None ticked: every model the platform allows.'}
            </p>
            {errors.allowedModels ? <p className="text-[13px] text-danger-700">{errors.allowedModels}</p> : null}
          </div>

          <Field label="Default model" error={errors.defaultModel} hint="Agents set to “Workspace default” use it at every turn.">
            <Select
              value={draft.defaultModel ?? PLATFORM_DEFAULT}
              onValueChange={(value) => setDraft((current) => ({ ...current, defaultModel: value === PLATFORM_DEFAULT ? null : value }))}
              options={[
                { value: PLATFORM_DEFAULT, label: 'Platform default', description: base.effective.platformAllowlist.length ? undefined : 'Whatever the platform is configured with.' },
                ...defaultChoices.map((name) => ({ value: name, label: <span className="font-mono text-[12.5px]">{name}</span> })),
              ]}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Answer length ceiling" optional error={errors.maxOutputTokens} hint="Tokens, 16–65,536. Empty inherits the platform's.">
              <Input value={draft.maxOutputTokens} onChange={(event) => setDraft((current) => ({ ...current, maxOutputTokens: event.target.value }))} inputMode="numeric" placeholder="Inherit" inputClassName="font-mono tabular" />
            </Field>
            <Field label="Context window ceiling" optional error={errors.maxContextTokens} hint="Tokens, 512–1,048,576. Empty inherits the platform's.">
              <Input value={draft.maxContextTokens} onChange={(event) => setDraft((current) => ({ ...current, maxContextTokens: event.target.value }))} inputMode="numeric" placeholder="Inherit" inputClassName="font-mono tabular" />
            </Field>
          </div>

          {removed.length ? (
            <Callout tone="warning" icon={<TriangleAlert className="size-4" />}>
              Agents pinned to {removed.join(', ')} will fail with “model not allowed” until someone edits them. Agents on “Workspace default” are fine.
            </Callout>
          ) : null}
          <FormError message={formError ?? undefined} />
        </CardBody>
        <CardFooter>
          <Button variant="ghost" onClick={() => setDraft(draftFromLlmPolicy(base))} disabled={!patch || save.isPending}>
            <RotateCcw />
            Discard
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!patch || Object.keys(errors).length > 0}>
            {save.isPending ? null : <Save />}
            Save policy
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

