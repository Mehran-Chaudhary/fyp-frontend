import { CircleHelp, Gauge, GitMerge, Languages, ListChecks, RefreshCw, ShieldAlert, ShieldCheck, Tags, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { TagInput } from '@/components/ui/tag-input';
import { hasCode, isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { PiiEntityType, PiiPolicy } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { humanizeEntityType } from '@/lib/knowledge/pii';
import {
  describePolicyChanges,
  draftFromPolicy,
  FAILURE_MODE_LABEL,
  formatThreshold,
  MAX_TERM_LENGTH,
  MAX_TERMS,
  policyPatch,
  rebaseDraft,
  validatePolicyDraft,
  weakeningsOf,
  type PolicyDraft,
  type PolicyErrors,
} from '@/lib/knowledge/pii-policy';
import { toast } from '@/lib/toast';
import { cn, pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { EntityTypePicker } from './entity-type-picker';
import { refetchPolicy, useUpdatePolicy } from './use-privacy';

type Errors = PolicyErrors & { form?: string };

/**
 * The redaction policy (spec §5 "Privacy settings", P3-API-17/18). Editable with
 * pii:policy:update, read-only otherwise. A save sends `expectedVersion` and only
 * the fields that changed, never a no-op (P3-G05); changes that mask less are
 * acknowledged explicitly; a 409 shows what changed on the server and lets you
 * re-apply your edits on top; a lost answer is checked, never resent.
 */
export function PolicyEditor({
  policy,
  catalogue,
  editable,
}: {
  /** The server's current copy (it may change while you edit). */
  policy: PiiPolicy;
  catalogue: readonly PiiEntityType[];
  editable: boolean;
}) {
  const workspace = useWorkspace();
  const save = useUpdatePolicy();
  const [base, setBase] = useState<PiiPolicy>(policy);
  const [draft, setDraft] = useState<PolicyDraft>(() => draftFromPolicy(policy));
  const [errors, setErrors] = useState<Errors>({});
  const [conflicted, setConflicted] = useState(false);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const patch = editable ? policyPatch(base, draft) : null;
  const dirty = patch !== null;
  const newer = policy.version !== base.version || policy.updatedAt !== base.updatedAt;

  // Keep in step with the server while nothing is being edited.
  if (newer && !dirty && !uncertain) {
    setBase(policy);
    setDraft(draftFromPolicy(policy));
    setConflicted(false);
  }

  const { blocker } = useUnsavedChanges(dirty);
  const labelOf = (type: string) => catalogue.find((entry) => entry.type === type)?.label ?? humanizeEntityType(type);
  const changes = patch ? describePolicyChanges(base, patch, labelOf) : [];
  const weakenings = patch ? weakeningsOf(base, patch, labelOf) : [];
  const serverChanges = newer && dirty ? describePolicyChanges(base, policyPatch(base, draftFromPolicy(policy)) ?? {}, labelOf) : [];

  const set = <K extends keyof PolicyDraft>(key: K, value: PolicyDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
  };

  const discard = () => {
    setBase(policy);
    setDraft(draftFromPolicy(policy));
    setErrors({});
    setConflicted(false);
  };

  const reapply = () => {
    setDraft(rebaseDraft(base, policy, draft));
    setBase(policy);
    setConflicted(false);
  };

  const review = () => {
    const problems = validatePolicyDraft(draft);
    setErrors(problems);
    if (Object.keys(problems).length || !patch) return;
    setAcknowledged(false);
    setReviewError(null);
    setReviewing(true);
  };

  const saved = (updated: PiiPolicy) => {
    setBase(updated);
    setDraft(draftFromPolicy(updated));
    setConflicted(false);
    setUncertain(null);
    toast.success(`Policy saved · version ${updated.version}`, { description: 'It applies to the next request everywhere.' });
  };

  const submit = () => {
    if (!patch) return;
    setReviewError(null);
    save.mutate(patch, {
      onSuccess: (updated) => {
        setReviewing(false);
        saved(updated);
      },
      onError: (error) => {
        if (hasCode(error, 'RESOURCE_CONFLICT')) {
          // Someone saved first. Re-read: the server's copy becomes `policy`, and the
          // "changed elsewhere" panel offers to re-apply these edits on top of it.
          setReviewing(false);
          setConflicted(true);
          void refetchPolicy(workspace.id).catch(() => undefined);
          return;
        }
        if (hasCode(error, 'VALIDATION_FAILED') && isApiError(error)) {
          setReviewing(false);
          const fields = error.fieldErrors({
            fields: ['enabled', 'entityTypes', 'scoreThreshold', 'onDetectorFailure', 'language', 'allowList', 'denyList'],
          });
          setErrors({ ...(fields as Errors), form: fields._form });
          return;
        }
        if (isOutcomeUnknown(error)) {
          setReviewing(false);
          setUncertain(error);
          return;
        }
        setReviewError(messageFor(error));
      },
    });
  };

  /** A lost answer: read the policy back. A newer version that matches the draft means it saved. */
  const check = async () => {
    setChecking(true);
    try {
      const current = await refetchPolicy(workspace.id);
      if (current.version === base.version) {
        setUncertain(null);
        setErrors({ form: "It wasn't saved. Your changes are still here; save again when ready." });
      } else if (policyPatch(current, draft) === null) {
        saved(current);
      } else {
        // A newer version that isn't exactly this draft: show what changed and let them decide.
        setUncertain(null);
        setConflicted(true);
      }
    } catch (error) {
      setErrors({ form: `Couldn't check: ${messageFor(error)}` });
    } finally {
      setChecking(false);
    }
  };

  const readOnly = !editable;
  const nerChosen = draft.entityTypes.some(
    (type) => policy.nerEntityTypes.includes(type) || catalogue.find((entry) => entry.type === type)?.detector === 'ner',
  );
  const denyCount = draft.denyList ? draft.denyList.length : policy.denyListCount;
  const masksNothing = draft.enabled && draft.entityTypes.length === 0 && denyCount === 0;

  return (
    <div className="grid grid-cols-1 gap-6">
      {readOnly ? (
        <Callout tone="neutral" icon={<CircleHelp className="size-4" />}>
          You can read this policy. Changing it needs <code className="font-mono text-[12px]">pii:policy:update</code>.
        </Callout>
      ) : null}

      {editable && newer && dirty ? (
        <Callout
          tone="warning"
          icon={<GitMerge className="size-4" />}
          title={
            conflicted
              ? `Not saved: version ${policy.version} was saved in the meantime`
              : `Version ${policy.version} was saved while you were editing`
          }
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="secondary" onClick={reapply}>
                Re-apply my changes on version {policy.version}
              </Button>
              <Button size="xs" variant="ghost" onClick={discard}>
                Discard my changes
              </Button>
            </div>
          }
        >
          {serverChanges.length ? (
            <>
              What changed on the server:
              <ul className="mt-1 grid gap-0.5">
                {serverChanges.map((change) => (
                  <li key={change.field}>
                    <span className="font-medium">{change.label}</span>: {change.from} → {change.to}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            'The newer version has the same settings as the one you started from.'
          )}
          <span className="mt-1 block opacity-90">Re-applying keeps the fields you changed and takes everything else from the newer version. You review it before saving.</span>
        </Callout>
      ) : null}

      {uncertain ? (
        <OutcomeUnknown
          error={uncertain}
          action={
            <Button size="xs" variant="secondary" onClick={() => void check()} loading={checking}>
              {checking ? null : <RefreshCw />}
              Check whether it saved
            </Button>
          }
        >
          No answer arrived, so the policy may have been saved. Saving again would create another version, so check first.
        </OutcomeUnknown>
      ) : null}

      {/* ── Master switch ── */}
      <Card>
        <CardHeader icon={<ShieldCheck />} title="Redaction" description="Whether personal data is masked before text is sent to a model." />
        <CardBody className="grid grid-cols-1 gap-3">
          <label className={cn('flex items-start gap-3', readOnly ? 'cursor-default' : 'cursor-pointer')}>
            <Switch checked={draft.enabled} onCheckedChange={(on) => set('enabled', on)} disabled={readOnly} aria-label="Mask personal data" className="mt-0.5" />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">Mask personal data before it reaches a model</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">
                Chat, agents and tools use the masked text. Search results and chunks are still shown unmasked to people cleared to read
                the document.
              </span>
            </span>
          </label>
          {!draft.enabled ? (
            <Callout tone="warning" icon={<ShieldAlert className="size-4" />}>
              With redaction off, models receive text exactly as stored. This is an explicit decision and is recorded in the audit
              log.
            </Callout>
          ) : masksNothing ? (
            <Callout tone="warning" icon={<TriangleAlert className="size-4" />}>
              No entity types are chosen and the deny list is empty, so nothing will be masked.
            </Callout>
          ) : null}
        </CardBody>
      </Card>

      {/* ── What to mask ── */}
      <Card>
        <CardHeader
          icon={<ListChecks />}
          title="What to mask"
          description="Each detected value gets a typed, numbered placeholder. The same value keeps the same placeholder throughout one text."
        />
        <CardBody>
          <EntityTypePicker
            value={draft.entityTypes}
            onChange={(types) => set('entityTypes', types)}
            catalogue={catalogue}
            nerEntityTypes={policy.nerEntityTypes}
            denyListCount={denyCount}
            readOnly={readOnly}
            error={errors.entityTypes}
          />
        </CardBody>
      </Card>

      {/* ── Detection ── */}
      <Card>
        <CardHeader icon={<Gauge />} title="Detection" description="How sure a detector must be, and what happens when name detection is down." />
        <CardBody className="grid grid-cols-1 gap-6">
          <ThresholdField value={draft.scoreThreshold} onChange={(value) => set('scoreThreshold', value)} readOnly={readOnly} error={errors.scoreThreshold} />

          <div className="grid gap-2">
            <p className="text-[13px] font-medium text-ink-soft" id="failure-mode-label">
              If name detection is unavailable
            </p>
            <RadioGroup
              aria-labelledby="failure-mode-label"
              value={draft.onDetectorFailure}
              onValueChange={(mode) => set('onDetectorFailure', mode)}
              disabled={readOnly}
              variant="cards"
              orientation="horizontal"
              options={[
                {
                  value: 'REFUSE',
                  label: FAILURE_MODE_LABEL.REFUSE,
                  description: 'Fail closed: nothing reaches a model unprotected. Requests answer “detection unavailable” until it’s back.',
                },
                {
                  value: 'DEGRADE_TO_PATTERNS',
                  label: FAILURE_MODE_LABEL.DEGRADE_TO_PATTERNS,
                  description: 'Keep working with pattern detections only. Names, places and organisations pass through meanwhile.',
                },
              ]}
            />
            {nerChosen && !policy.nerDetector.configured ? (
              <Callout tone="warning" icon={<TriangleAlert className="size-4" />}>
                Name detection isn't configured on this server.{' '}
                {draft.onDetectorFailure === 'REFUSE'
                  ? 'With “Refuse”, every request that needs names masked is refused until it is.'
                  : 'Only pattern detections are masked until it is.'}
              </Callout>
            ) : null}
          </div>

          <Field label="Language" error={errors.language} hint="The language the NER model reads, such as en or en-GB." className="sm:max-w-xs">
            <Input
              value={draft.language}
              onChange={(event) => set('language', event.target.value)}
              readOnly={readOnly}
              maxLength={5}
              inputClassName="font-mono"
              leading={<Languages />}
            />
          </Field>
        </CardBody>
      </Card>

      {/* ── Terms ── */}
      <Card>
        <CardHeader icon={<Tags />} title="Terms" description="Exceptions and additions that patterns and models can't know about." />
        <CardBody className="grid gap-6 lg:grid-cols-2">
          <Field
            label="Never mask"
            optional
            error={errors.allowList}
            hint={`Values left as they are, such as your organisation's own name. Up to ${MAX_TERMS} terms of ${MAX_TERM_LENGTH} characters.`}
          >
            {readOnly ? (
              <TermList terms={draft.allowList} empty="No exceptions." />
            ) : (
              <TagInput
                value={draft.allowList}
                onChange={(terms) => set('allowList', terms)}
                max={MAX_TERMS}
                normalize={(entry) => entry.trim()}
                validate={(entry) => (entry.length > MAX_TERM_LENGTH ? `Terms are at most ${MAX_TERM_LENGTH} characters.` : null)}
                placeholder="Acme Corporation"
              />
            )}
          </Field>
          <Field
            label="Always mask"
            optional
            error={errors.denyList}
            hint={
              draft.denyList === null
                ? undefined
                : `Masked as Custom: project code names, clients under NDA. Stored encrypted; only people who can change this policy see them.`
            }
          >
            {draft.denyList === null ? (
              <p className="rounded-lg border border-line bg-well/40 px-3 py-2.5 text-[13px] text-ink-soft">
                {policy.denyListCount === 0
                  ? 'No private terms.'
                  : `${pluralize(policy.denyListCount, 'private term')} ${policy.denyListCount === 1 ? 'is' : 'are'} always masked.`}{' '}
                <span className="text-muted">Only people who can change the policy can see them.</span>
              </p>
            ) : readOnly ? (
              <TermList terms={draft.denyList} empty="No private terms." />
            ) : (
              <TagInput
                value={draft.denyList}
                onChange={(terms) => set('denyList', terms)}
                max={MAX_TERMS}
                normalize={(entry) => entry.trim()}
                validate={(entry) => (entry.length > MAX_TERM_LENGTH ? `Terms are at most ${MAX_TERM_LENGTH} characters.` : null)}
                placeholder="Project Falcon"
              />
            )}
          </Field>
        </CardBody>
      </Card>

      {editable ? (
        <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur-sm sm:flex-row sm:items-center sm:px-5">
          <div className="min-w-0 flex-1">
            {errors.form ? (
              <FormError message={errors.form} />
            ) : (
              <p className="text-[13px] text-muted" aria-live="polite">
                {dirty ? `${pluralize(changes.length, 'change')} to version ${base.version}.` : 'No changes. Saving is only possible once something changes.'}
              </p>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="ghost" onClick={discard} disabled={!dirty || save.isPending}>
              Discard
            </Button>
            <Button onClick={review} disabled={!dirty || !!uncertain} loading={save.isPending}>
              Review and save
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={reviewing}
        onOpenChange={(open) => (open ? undefined : setReviewing(false))}
        icon={weakenings.length ? <ShieldAlert /> : <ShieldCheck />}
        tone={weakenings.length ? 'warning' : 'neutral'}
        size="lg"
        title={weakenings.length ? 'These changes mask less' : 'Save the redaction policy?'}
        description={`Version ${base.version} becomes version ${base.version + 1}. The new policy applies to the next request everywhere, and the change is recorded in the audit log.`}
        confirmLabel="Save policy"
        confirmVariant="primary"
        confirmDisabled={weakenings.length > 0 && !acknowledged}
        pending={save.isPending}
        error={reviewError}
        onConfirm={submit}
      >
        <ChangeTable changes={changes} />
        {weakenings.length ? (
          <div className="grid gap-3">
            <Callout tone="warning" icon={<ShieldAlert className="size-4" />} title="Less will be masked">
              <ul className="mt-0.5 grid list-disc gap-0.5 pl-4">
                {weakenings.map((weakening) => (
                  <li key={weakening.kind}>{weakening.text}</li>
                ))}
              </ul>
            </Callout>
            <Checkbox
              checked={acknowledged}
              onCheckedChange={setAcknowledged}
              label="I understand that more personal data can reach models"
              description="The audit log records this change as weakening the policy."
            />
          </div>
        ) : null}
      </ConfirmDialog>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

function ChangeTable({ changes }: { changes: ReadonlyArray<{ field: string; label: string; from: string; to: string }> }) {
  return (
    <dl className="divide-y divide-line/70 rounded-lg border border-line text-[13px]">
      {changes.map((change) => (
        <div key={change.field} className="grid gap-1 px-3.5 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <dt className="font-medium text-ink-soft">{change.label}</dt>
          <dd className="min-w-0 break-words text-muted">
            <span className="text-faint line-through decoration-line-strong">{change.from}</span>
            <span aria-hidden> → </span>
            <span className="sr-only"> becomes </span>
            <span className="font-medium text-ink">{change.to}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TermList({ terms, empty }: { terms: readonly string[]; empty: string }) {
  if (terms.length === 0) return <p className="text-[13px] text-faint">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {terms.map((term) => (
        <li key={term} className="rounded-md border border-line bg-well px-1.5 py-0.5 text-[12.5px] text-ink-soft">
          {term}
        </li>
      ))}
    </ul>
  );
}

function ThresholdField({
  value,
  onChange,
  readOnly,
  error,
}: {
  value: number;
  onChange: (value: number) => void;
  readOnly: boolean;
  error?: string;
}) {
  const [text, setText] = useState(formatThreshold(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(formatThreshold(value));
  }

  const hint: ReactNode = (
    <>
      Detections scoring below this pass through unmasked. Lower masks more, including things that may not be personal data.
    </>
  );

  return (
    <Field label="Minimum confidence" error={error} hint={hint}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          disabled={readOnly}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label="Minimum confidence"
          className="h-2 w-full max-w-xs cursor-pointer accent-[var(--color-brand-600)] disabled:cursor-default"
        />
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={1}
          step={0.01}
          value={text}
          readOnly={readOnly}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = Number(event.target.value);
            if (event.target.value.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
          }}
          aria-label="Minimum confidence, 0 to 1"
          className="w-24"
          inputClassName="h-9 font-mono tabular"
        />
      </div>
    </Field>
  );
}
