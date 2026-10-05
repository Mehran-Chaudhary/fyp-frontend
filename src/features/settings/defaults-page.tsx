import { Archive, FileStack, Info } from 'lucide-react';
import { useState } from 'react';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Segmented } from '@/components/ui/segmented';
import { isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { Organization, OrganizationSettingsPatch } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { useCan } from '@/features/workspaces/workspace-context';
import { useUpdateWorkspace } from './use-update-workspace';
import { ReadOnlyHint, WorkspaceDetailsGate } from './workspace-details-gate';

/** Backend source defaults. The running deployment's values aren't exposed (spec §4 "Settings forms"). */
const SOURCE_DEFAULT_SIZE = 512;
const SOURCE_DEFAULT_OVERLAP = 64;
const RETENTION_MIN = 30;
const RETENTION_MAX = 3650;

/** Settings → Defaults (spec §4 `/settings/defaults`): chunking defaults and audit retention. */
export function DefaultsSettingsPage() {
  useDocumentTitle('Defaults');
  return (
    <WorkspaceDetailsGate what="the workspace defaults" skeleton={[14, 11]}>
      {(organization) => {
        const settings = organization.settings;
        return (
          <div className="grid gap-6">
            {/* Keyed by the stored values: a save elsewhere resets the untouched form. */}
            <ProcessingCard
              key={`chunks:${settings.defaultChunkSize ?? 'inherit'}:${settings.defaultChunkOverlap ?? 'inherit'}`}
              organization={organization}
            />
            <RetentionCard key={`retention:${settings.auditRetentionDays ?? 'inherit'}`} organization={organization} />
          </div>
        );
      }}
    </WorkspaceDetailsGate>
  );
}

type Mode = 'inherit' | 'custom';

// ── Document processing ─────────────────────────────────────────────────────

function ProcessingCard({ organization }: { organization: Organization }) {
  const can = useCan();
  const editable = can('workspace:update');
  const settings = organization.settings;
  const [size, setSize] = useState(settings.defaultChunkSize != null ? String(settings.defaultChunkSize) : '');
  const [overlap, setOverlap] = useState(settings.defaultChunkOverlap != null ? String(settings.defaultChunkOverlap) : '');
  const [sizeMode, setSizeMode] = useState<Mode>(settings.defaultChunkSize != null ? 'custom' : 'inherit');
  const [overlapMode, setOverlapMode] = useState<Mode>(settings.defaultChunkOverlap != null ? 'custom' : 'inherit');
  const [errors, setErrors] = useState<{ size?: string; overlap?: string; form?: string }>({});
  const [uncertain, setUncertain] = useState<unknown>(null);
  const save = useUpdateWorkspace();

  const nextSize = sizeMode === 'inherit' ? null : Number(size);
  const nextOverlap = overlapMode === 'inherit' ? null : Number(overlap);
  const sizeChanged = nextSize !== (settings.defaultChunkSize ?? null);
  const overlapChanged = nextOverlap !== (settings.defaultChunkOverlap ?? null);
  const oneInherited = (nextSize === null) !== (nextOverlap === null);

  const submit = () => {
    const problems: typeof errors = {};
    if (nextSize !== null && !(Number.isInteger(nextSize) && nextSize >= 64 && nextSize <= 4096)) {
      problems.size = 'Use a whole number between 64 and 4096.';
    }
    if (nextOverlap !== null && !(Number.isInteger(nextOverlap) && nextOverlap >= 0 && nextOverlap <= 1024)) {
      problems.overlap = 'Use a whole number between 0 and 1024.';
    }
    // Only checked when both values are known here; otherwise the server checks against its default.
    if (!problems.size && !problems.overlap && nextSize !== null && nextOverlap !== null && nextOverlap >= nextSize) {
      problems.overlap = `Must be smaller than the chunk size (${nextSize}).`;
    }
    setErrors(problems);
    setUncertain(null);
    if (Object.keys(problems).length) return;

    // Merge patch: only the changed keys; null removes the override.
    const patch: OrganizationSettingsPatch = {};
    if (sizeChanged) patch.defaultChunkSize = nextSize;
    if (overlapChanged) patch.defaultChunkOverlap = nextOverlap;
    save.mutate(
      { settings: patch },
      {
        onSuccess: () =>
          toast.success('Processing defaults saved', {
            description: 'Applies to documents processed or reindexed from now on, in knowledge bases without their own values.',
          }),
        onError: (err) => {
          if (isOutcomeUnknown(err)) {
            setUncertain(err);
          } else if (isApiError(err) && err.code === 'VALIDATION_FAILED') {
            const fields = err.fieldErrors({ fields: ['settings.defaultChunkSize', 'settings.defaultChunkOverlap'] });
            const size = fields['settings.defaultChunkSize'];
            const overlap = fields['settings.defaultChunkOverlap'];
            setErrors({ size, overlap, form: fields._form ?? (size || overlap ? undefined : err.message) });
          } else {
            setErrors({ form: messageFor(err) });
          }
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        icon={<FileStack />}
        title="Document processing"
        description="Chunking defaults for knowledge bases that don't set their own. Changes apply to documents processed or reindexed afterwards."
      />
      <CardBody className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <ChunkField
            label="Default chunk size"
            unit="tokens"
            range="64–4096"
            sourceDefault={SOURCE_DEFAULT_SIZE}
            mode={sizeMode}
            onModeChange={(mode) => {
              setSizeMode(mode);
              if (mode === 'custom' && !size) setSize(String(SOURCE_DEFAULT_SIZE));
              setErrors({});
            }}
            value={size}
            onValueChange={(value) => {
              setSize(value);
              setErrors({});
            }}
            error={errors.size}
            disabled={!editable}
          />
          <ChunkField
            label="Default chunk overlap"
            unit="tokens"
            range="0–1024, below the chunk size"
            sourceDefault={SOURCE_DEFAULT_OVERLAP}
            mode={overlapMode}
            onModeChange={(mode) => {
              setOverlapMode(mode);
              if (mode === 'custom' && !overlap) setOverlap(String(SOURCE_DEFAULT_OVERLAP));
              setErrors({});
            }}
            value={overlap}
            onValueChange={(value) => {
              setOverlap(value);
              setErrors({});
            }}
            error={errors.overlap}
            disabled={!editable}
          />
        </div>
        {editable && oneInherited ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            One value comes from the deployment, which this page can't read. The server checks that the overlap stays
            below the size using its own value, and says so if it doesn't.
          </p>
        ) : null}
        {uncertain ? (
          <OutcomeUnknown error={uncertain}>
            The change may have been saved. The stored values are being re-read: if it went through, this card
            reloads with them. Check before saving again.
          </OutcomeUnknown>
        ) : null}
        <FormError message={errors.form} />
      </CardBody>
      <CardFooter className="justify-between">
        {editable ? <span /> : <ReadOnlyHint />}
        {editable ? (
          <Button disabled={!sizeChanged && !overlapChanged} loading={save.isPending} onClick={submit}>
            Save processing defaults
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function ChunkField({
  label,
  unit,
  range,
  sourceDefault,
  mode,
  onModeChange,
  value,
  onValueChange,
  error,
  disabled,
}: {
  label: string;
  unit: string;
  range: string;
  sourceDefault: number;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <Field
      label={label}
      error={error}
      hint={
        mode === 'custom'
          ? `${range} ${unit}.`
          : `Set by the deployment (${sourceDefault} in the backend's development defaults).`
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {disabled ? (
          <span className="text-[13px] text-ink-soft">
            {mode === 'inherit' ? (
              <Badge tone="neutral">Deployment default</Badge>
            ) : (
              <span className="font-mono tabular">
                {value} {unit}
              </span>
            )}
          </span>
        ) : (
          <>
            <Segmented
              aria-label={`${label}: deployment default or a workspace value`}
              size="xs"
              value={mode}
              onValueChange={onModeChange}
              options={[
                { value: 'inherit', label: 'Deployment default' },
                { value: 'custom', label: 'Workspace value' },
              ]}
            />
            {mode === 'custom' ? (
              <span className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={value}
                  onChange={(event) => onValueChange(event.target.value)}
                  aria-label={`${label} in ${unit}`}
                  aria-invalid={!!error || undefined}
                  className="w-24"
                  inputClassName="h-9 font-mono tabular"
                />
                <span className="text-[13px] text-muted">{unit}</span>
              </span>
            ) : null}
          </>
        )}
      </div>
    </Field>
  );
}

// ── Audit retention ─────────────────────────────────────────────────────────

function RetentionCard({ organization }: { organization: Organization }) {
  const can = useCan();
  const editable = can('workspace:update');
  const current = organization.settings.auditRetentionDays ?? null;
  const [mode, setMode] = useState<Mode>(current === null ? 'inherit' : 'custom');
  const [days, setDays] = useState(String(current ?? 365));
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const save = useUpdateWorkspace();

  const parsed = Number(days);
  const valid = mode === 'inherit' || (Number.isInteger(parsed) && parsed >= RETENTION_MIN && parsed <= RETENTION_MAX);
  const next = mode === 'inherit' ? null : parsed;
  const dirty = next !== current;

  const submit = () => {
    setError(null);
    setUncertain(null);
    if (!valid) {
      setError(`Enter a whole number of days between ${RETENTION_MIN} and ${RETENTION_MAX}.`);
      return;
    }
    save.mutate(
      { settings: { auditRetentionDays: next } },
      {
        onSuccess: () =>
          toast.success('Retention saved', {
            description:
              next === null
                ? 'The deployment’s retention applies again.'
                : `Audit records older than ${pluralize(next, 'day')} become eligible for archiving, subject to the platform minimum.`,
          }),
        onError: (err) => {
          if (isOutcomeUnknown(err)) setUncertain(err);
          else if (isApiError(err) && err.code === 'VALIDATION_FAILED') {
            setError(err.fieldErrors({ fields: ['settings.auditRetentionDays'] })['settings.auditRetentionDays'] ?? err.message);
          } else setError(messageFor(err));
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        icon={<Archive />}
        title="Audit retention"
        description="How long audit records stay in the live log before the retention job archives them."
      />
      <CardBody className="grid gap-4">
        <RadioGroup<Mode>
          aria-label="Audit retention"
          value={mode}
          onValueChange={(value) => {
            setMode(value);
            setError(null);
          }}
          disabled={!editable}
          variant="cards"
          orientation="horizontal"
          options={[
            {
              value: 'inherit',
              label: 'Deployment default',
              description: 'No workspace override. The platform’s own retention setting applies.',
            },
            {
              value: 'custom',
              label: 'Workspace value',
              description: 'Archive records older than a number of days.',
              children: (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={RETENTION_MIN}
                    max={RETENTION_MAX}
                    value={days}
                    readOnly={!editable}
                    onChange={(event) => {
                      setDays(event.target.value);
                      setError(null);
                    }}
                    aria-label="Retention in days"
                    aria-invalid={!valid || undefined}
                    className="w-28"
                    inputClassName="font-mono tabular"
                  />
                  <span className="text-[13px] text-muted">
                    days ({RETENTION_MIN}–{RETENTION_MAX})
                  </span>
                </div>
              ),
            },
          ]}
        />
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          Subject to the platform minimum: the retention job never archives sooner than the deployment allows, so a short
          value here may not take effect. Saving doesn't promise an exact deletion date.
        </p>
        {uncertain ? (
          <OutcomeUnknown error={uncertain}>
            The change may have been saved. The stored value is being re-read: if it went through, this card reloads
            with it. Check before saving again.
          </OutcomeUnknown>
        ) : null}
        <FormError message={error ?? undefined} />
      </CardBody>
      <CardFooter className="justify-between">
        {editable ? <span /> : <ReadOnlyHint />}
        {editable ? (
          <Button disabled={!dirty} loading={save.isPending} onClick={submit}>
            Save retention
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
