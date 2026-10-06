import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Boxes, Cpu, Info, Lock, ShieldHalf, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import type { KnowledgeBase } from '@/lib/api/types';
import { workspaceDetailsQuery } from '@/lib/queries';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { CLASSIFICATION_META } from '../shared/meta';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';
import {
  CHUNK_OVERLAP_MAX,
  CHUNK_SIZE_MAX,
  CHUNK_SIZE_MIN,
  DESCRIPTION_MAX,
  initialValues,
  NAME_MAX,
  PLATFORM_CHUNK_OVERLAP,
  PLATFORM_CHUNK_SIZE,
  validateKbForm,
  type ChunkMode,
  type InheritedChunking,
  type KbFormErrors,
  type KbFormValues,
} from './kb-form-model';

interface KnowledgeBaseFormProps {
  /** Editing this base; creating when absent. */
  knowledgeBase?: KnowledgeBase;
  readOnly?: boolean;
  /** Shown above the form when it's read-only. */
  readOnlyReason?: ReactNode;
  submitLabel: string;
  pending: boolean;
  /** Returns the server's refusals, mapped to fields, or nothing when it succeeded. */
  onSubmit: (values: KbFormValues) => Promise<KbFormErrors | void>;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/** Create and edit a knowledge base (§5 "Knowledge bases"). */
export function KnowledgeBaseForm({
  knowledgeBase,
  readOnly,
  readOnlyReason,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  onDirtyChange,
}: KnowledgeBaseFormProps) {
  const workspace = useWorkspace();
  const can = useCan();
  const access = useKnowledgeAccess();
  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: can('workspace:read') });
  const inherited: InheritedChunking = {
    size: details.data?.settings.defaultChunkSize ?? null,
    overlap: details.data?.settings.defaultChunkOverlap ?? null,
  };
  const knownInherited = !!details.data;

  // A base may carry a default above your clearance (you can still view it): keep it in the list.
  const classificationChoices = knowledgeBase && !access.assignable.includes(knowledgeBase.defaultClassification)
    ? [...access.assignable, knowledgeBase.defaultClassification]
    : access.assignable;

  const [baseline] = useState(() => initialValues(knowledgeBase, access.assignable));
  const [values, setValues] = useState<KbFormValues>(baseline);
  const [errors, setErrors] = useState<KbFormErrors>({});
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const set = <K extends keyof KbFormValues>(key: K, value: KbFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
  };

  const submit = async () => {
    const problems = validateKbForm(values, inherited, access.assignable);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    const refused = await onSubmit(values);
    if (refused) setErrors(refused);
  };

  const inheritSizeLabel = knownInherited
    ? inherited.size !== null
      ? `Inherit (${inherited.size}, workspace)`
      : `Inherit (${PLATFORM_CHUNK_SIZE}, default)`
    : 'Inherit';
  const inheritOverlapLabel = knownInherited
    ? inherited.overlap !== null
      ? `Inherit (${inherited.overlap}, workspace)`
      : `Inherit (${PLATFORM_CHUNK_OVERLAP}, default)`
    : 'Inherit';

  return (
    <form
      noValidate
      className="grid grid-cols-1 gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly) void submit();
      }}
    >
      {readOnly && readOnlyReason ? (
        <Callout tone="neutral" icon={<Info className="size-4" />}>
          {readOnlyReason}
        </Callout>
      ) : null}

      <Card>
        <CardHeader icon={<Boxes />} title="Knowledge base" description="What it holds, in a name people will recognise." />
        <CardBody className="grid grid-cols-1 gap-5">
          <Field label="Name" error={errors.name}>
            <Input
              value={values.name}
              onChange={(event) => set('name', event.target.value)}
              maxLength={NAME_MAX + 10}
              readOnly={readOnly}
              placeholder="HR Policies"
              autoFocus={!knowledgeBase && !readOnly}
            />
          </Field>
          <Field
            label="Description"
            optional
            error={errors.description}
            hint={readOnly ? undefined : <span className="tabular">{values.description.length}/{DESCRIPTION_MAX}{knowledgeBase ? ' · Leave empty to remove it.' : ''}</span>}
          >
            <Textarea
              rows={3}
              value={values.description}
              onChange={(event) => set('description', event.target.value)}
              readOnly={readOnly}
              placeholder="Leave, benefits and conduct policies for all staff."
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<ShieldHalf />}
          title="Access"
          description="Who can see this knowledge base, and how new documents are classified by default."
        />
        <CardBody className="grid grid-cols-1 gap-5">
          <RadioGroup
            aria-label="Access"
            value={values.accessMode}
            onValueChange={(mode) => set('accessMode', mode)}
            disabled={readOnly}
            variant="cards"
            orientation="horizontal"
            options={[
              {
                value: 'WORKSPACE',
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3.5 text-faint" aria-hidden />
                    Workspace
                  </span>
                ),
                description: 'Everyone with document permissions can see it, up to their clearance.',
              },
              {
                value: 'RESTRICTED',
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="size-3.5 text-faint" aria-hidden />
                    Restricted
                  </span>
                ),
                description: "Only people, roles and API keys you grant can see it. Everyone else won't know it exists.",
              },
            ]}
          />
          {values.accessMode === 'RESTRICTED' && !knowledgeBase && !access.isOwner ? (
            <p className="-mt-2 text-xs text-muted">You'll get Manage access automatically, so you can grant others access next.</p>
          ) : null}
          <Field
            label="Default classification"
            error={errors.defaultClassification}
            hint="Used for uploads that don't choose one. You can only pick classifications within your clearance."
            className="sm:max-w-sm"
          >
            <Select
              value={values.defaultClassification}
              onValueChange={(value) => set('defaultClassification', value)}
              disabled={readOnly}
              options={classificationChoices.map((classification) => ({
                value: classification,
                label: CLASSIFICATION_META[classification].label,
                description: CLASSIFICATION_META[classification].description,
                disabled: !access.assignable.includes(classification),
              }))}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<Cpu />}
          title="Chunking and embedding"
          description="How documents are split before they're embedded. Changes apply to documents processed after the change."
          actions={
            can('workspace:read') ? (
              <Button asChild variant="ghost" size="xs">
                <Link to={`/w/${workspace.slug}/settings/defaults`}>
                  <span className="hidden sm:inline">Inherited from workspace settings</span>
                  <span className="sm:hidden">Workspace defaults</span>
                  <ArrowUpRight />
                </Link>
              </Button>
            ) : null
          }
        />
        <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <ChunkField
            label="Chunk size"
            range={`${CHUNK_SIZE_MIN}–${CHUNK_SIZE_MAX} tokens`}
            inheritLabel={inheritSizeLabel}
            mode={values.chunkSizeMode}
            value={values.chunkSize}
            error={errors.chunkSize}
            readOnly={readOnly}
            onModeChange={(mode) => {
              set('chunkSizeMode', mode);
              if (mode === 'custom' && !values.chunkSize) set('chunkSize', String(inherited.size ?? PLATFORM_CHUNK_SIZE));
            }}
            onValueChange={(value) => set('chunkSize', value)}
          />
          <ChunkField
            label="Chunk overlap"
            range={`0–${CHUNK_OVERLAP_MAX} tokens, below the size`}
            inheritLabel={inheritOverlapLabel}
            mode={values.chunkOverlapMode}
            value={values.chunkOverlap}
            error={errors.chunkOverlap}
            readOnly={readOnly}
            onModeChange={(mode) => {
              set('chunkOverlapMode', mode);
              if (mode === 'custom' && !values.chunkOverlap) set('chunkOverlap', String(inherited.overlap ?? PLATFORM_CHUNK_OVERLAP));
            }}
            onValueChange={(value) => set('chunkOverlap', value)}
          />
          <div className="rounded-lg border border-line bg-well/40 px-3.5 py-3 sm:col-span-2">
            <p className="text-[13px] font-medium text-ink-soft">Embedding model</p>
            {knowledgeBase ? (
              <p className="mt-0.5 text-[13px] text-muted">
                <span className="font-mono text-[12.5px] text-ink">{knowledgeBase.embeddingModel}</span> ·{' '}
                {knowledgeBase.embeddingDimensions} dimensions. Fixed when the knowledge base was created.
              </p>
            ) : (
              <p className="mt-0.5 text-[13px] text-muted">The server's current model is used, and stays fixed for this knowledge base.</p>
            )}
          </div>
        </CardBody>
      </Card>

      {readOnly ? null : (
        <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur-sm sm:flex-row sm:items-center sm:px-5">
          <div className="min-w-0 flex-1">
            {errors.form ? (
              <FormError message={errors.form} />
            ) : (
              <p className="text-[13px] text-muted">
                {knowledgeBase ? (dirty ? 'You have unsaved changes.' : 'No changes.') : 'You can change everything except the embedding model later.'}
              </p>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            {onCancel ? (
              <Button variant="ghost" onClick={onCancel} disabled={pending}>
                Cancel
              </Button>
            ) : knowledgeBase ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setValues(baseline);
                  setErrors({});
                }}
                disabled={!dirty || pending}
              >
                Discard
              </Button>
            ) : null}
            <Button type="submit" loading={pending} disabled={!!knowledgeBase && !dirty}>
              {submitLabel}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

function ChunkField({
  label,
  range,
  inheritLabel,
  mode,
  value,
  error,
  readOnly,
  onModeChange,
  onValueChange,
}: {
  label: string;
  range: string;
  inheritLabel: string;
  mode: ChunkMode;
  value: string;
  error?: string;
  readOnly?: boolean;
  onModeChange: (mode: ChunkMode) => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <Field label={label} error={error} hint={mode === 'custom' ? range : 'Follows the workspace setting.'}>
      {readOnly ? (
        <span className="text-[13px] text-ink-soft">{mode === 'inherit' ? inheritLabel : `${value} tokens`}</span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            aria-label={`${label}: inherit or custom`}
            size="xs"
            value={mode}
            onValueChange={onModeChange}
            options={[
              { value: 'inherit', label: inheritLabel },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          {mode === 'custom' ? (
            <span className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                className="w-24"
                inputClassName="h-9 font-mono tabular"
                aria-label={`${label} in tokens`}
              />
              <span className="text-[13px] text-muted">tokens</span>
            </span>
          ) : null}
        </div>
      )}
    </Field>
  );
}
