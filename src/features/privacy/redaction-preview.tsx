import { ChevronDown, Eye, EyeOff, FlaskConical, Info, Play, ShieldAlert, ShieldOff, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { RequestReference } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { AnalyzeResult, PiiEntityType, PiiPolicy } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { humanizeEntityType } from '@/lib/knowledge/pii';
import { useCountdown } from '@/lib/hooks';
import { cn, formatCountdown, pluralize } from '@/lib/utils';
import { useCan } from '@/features/workspaces/workspace-context';
import { EntityCounts, MaskedText } from '@/features/knowledge/shared/masked-text';
import { entityTone } from '@/features/knowledge/shared/pii-colors';
import { sampleFromCatalogue, SAMPLE_TEXTS, SOURCE_LABEL } from './privacy-copy';
import { useAnalyze } from './use-privacy';

/** The deployment default (PII_MAX_ANALYZE_LENGTH); the server has the final word with a 422. */
const DEFAULT_MAX_LENGTH = 20_000;
/** The DTO's own ceiling: nothing longer is ever sent. */
const HARD_MAX_LENGTH = 200_000;

/**
 * Test the policy on any text (spec §5 "Analysis preview", P3-API-20): the masked
 * output exactly as a model would receive it, every detection, and whether name
 * detection was degraded. The text and the result stay on this screen only.
 * "Reveal values" needs pii:reveal and a confirmation, because each reveal is a
 * CRITICAL audit event.
 */
export function RedactionPreview({ policy, catalogue }: { policy: PiiPolicy; catalogue: readonly PiiEntityType[] }) {
  const can = useCan();
  const analyze = useAnalyze();
  const [text, setText] = useState('');
  const [confirmReveal, setConfirmReveal] = useState(false);
  const labels = new Map(catalogue.map((type) => [type.type, type]));
  const canReveal = can('pii:reveal');
  const canEdit = can('pii:policy:update');
  const fromCatalogue = sampleFromCatalogue(catalogue);
  const remaining = useCountdown(analyze.analysis?.expiresAt ?? null, analyze.hideValues);
  const retryIn = useCountdown(
    hasCode(analyze.error, 'RATE_LIMIT_EXCEEDED') ? analyze.failedAt + (analyze.error.retryAfterSeconds ?? 60) * 1000 : null,
  );

  const length = text.length;
  const tooLong = length > HARD_MAX_LENGTH;
  const blank = !text.trim();
  const run = (reveal: boolean) => {
    if (blank || tooLong || analyze.pending || retryIn > 0) return;
    analyze.run(text, { reveal, policyVersion: policy.version });
  };

  const result = analyze.analysis?.result ?? null;
  const stale = analyze.analysis && analyze.analysis.policyVersion !== policy.version;

  return (
    <Card>
      <CardHeader
        icon={<FlaskConical />}
        title="Test the policy"
        description="Paste any text to see exactly what a model would receive under the saved policy. Nothing you type here is stored."
      />
      <CardBody className="grid grid-cols-1 gap-5">
        <form
          noValidate
          className="grid grid-cols-1 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(false);
          }}
        >
          <Field
            label="Text"
            labelAside={
              <span className={cn('text-xs tabular', length > DEFAULT_MAX_LENGTH ? 'text-warning-700' : 'text-faint')}>
                {length.toLocaleString()} / {DEFAULT_MAX_LENGTH.toLocaleString()}
              </span>
            }
            hint={
              length > DEFAULT_MAX_LENGTH
                ? `Longer than this deployment usually accepts (${DEFAULT_MAX_LENGTH.toLocaleString()} characters); the server may refuse it.`
                : undefined
            }
          >
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  run(false);
                }
              }}
              rows={5}
              className="min-h-28"
              placeholder="Ayesha Raza (ayesha.raza@acme.test, +92 300 1234567) earns PKR 950,000 per year."
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={blank || tooLong || retryIn > 0} loading={analyze.pending}>
              {analyze.pending ? null : <Play />}
              Show what a model receives
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" className="data-[state=open]:bg-well">
                  <Sparkles />
                  Try a sample
                  <ChevronDown className="text-faint" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60" align="start">
                <DropdownMenuLabel>Invented examples</DropdownMenuLabel>
                {SAMPLE_TEXTS.map((sample) => (
                  <DropdownMenuItem key={sample.key} onSelect={() => setText(sample.text)}>
                    {sample.label}
                  </DropdownMenuItem>
                ))}
                {fromCatalogue ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setText(fromCatalogue)}>One of each type this policy masks</DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {text || result ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setText('');
                  analyze.clear();
                }}
              >
                <X />
                Clear
              </Button>
            ) : null}
            {canReveal ? (
              <Button
                variant="ghost"
                className="sm:ml-auto"
                disabled={blank || tooLong || analyze.pending || retryIn > 0}
                onClick={() => setConfirmReveal(true)}
              >
                <Eye />
                Show with real values…
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-faint">
            Previews use the saved policy (version {policy.version}) and share the 30-a-minute privacy budget with redaction reports.
          </p>
        </form>

        {analyze.error ? (
          <AnalyzeProblem error={analyze.error} retryIn={retryIn} canEdit={canEdit} />
        ) : null}

        {result ? (
          <Result
            result={result}
            labels={labels}
            policy={policy}
            stale={!!stale}
            remaining={remaining}
            onHide={analyze.hideValues}
          />
        ) : null}
      </CardBody>

      <ConfirmDialog
        open={confirmReveal}
        onOpenChange={setConfirmReveal}
        icon={<Eye />}
        tone="warning"
        size="md"
        title="Show the real values?"
        description="Each detection will show the value it masked. The reveal is recorded in the audit log as a critical event, with your name."
        confirmLabel="Reveal values"
        confirmVariant="primary"
        onConfirm={() => {
          setConfirmReveal(false);
          run(true);
        }}
      >
        <p className="text-[13px] leading-relaxed text-muted">
          The values stay on this screen only: never saved, and hidden again after a minute or when you leave this tab.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

function Result({
  result,
  labels,
  policy,
  stale,
  remaining,
  onHide,
}: {
  result: AnalyzeResult;
  labels: ReadonlyMap<string, PiiEntityType>;
  policy: PiiPolicy;
  stale: boolean;
  remaining: number;
  onHide: () => void;
}) {
  const [showTable, setShowTable] = useState(true);
  return (
    <section aria-label="What a model receives" className="grid grid-cols-1 gap-3" aria-live="polite">
      {stale ? (
        <Callout tone="info" icon={<Info className="size-4" />}>
          The policy changed since this preview ran. Run it again to see the new result.
        </Callout>
      ) : null}
      {result.degraded ? (
        <Callout tone="warning" icon={<TriangleAlert className="size-4" />} title="Name detection was unavailable">
          The policy allows pattern-only masking while it's down, so emails, numbers and the like were masked, but names, places and
          organisations were not.
        </Callout>
      ) : null}
      {!policy.enabled ? (
        <Callout tone="warning" icon={<ShieldOff className="size-4" />} title="Redaction is turned off">
          The text below is exactly what models receive: nothing is masked.
        </Callout>
      ) : null}
      {result.revealed ? (
        <Callout
          tone="warning"
          icon={<Eye className="size-4" />}
          role="status"
          action={
            <Button size="xs" variant="secondary" onClick={onHide}>
              <EyeOff />
              Hide now
            </Button>
          }
        >
          Real values are shown and hide again in <span className="tabular">{formatCountdown(remaining)}</span>.
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
        <span className="font-medium text-ink">
          {result.entityCount === 0 ? 'Nothing masked' : `${pluralize(result.entityCount, 'value')} masked`}
        </span>
        {result.detectors.length ? (
          <span className="flex flex-wrap items-center gap-1">
            {result.detectors.map((detector) => (
              <Badge key={detector} tone="outline">
                {detector}
              </Badge>
            ))}
          </span>
        ) : null}
        <span className="tabular text-faint" title={`Patterns ${result.timings.patternMs} ms · NER ${result.timings.nerMs} ms · masking ${result.timings.maskingMs} ms`}>
          {Math.round(result.timings.totalMs)} ms
        </span>
      </div>
      {result.entityCount > 0 ? <EntityCounts byType={result.byType} labels={labels} /> : null}

      <div className={cn('rounded-lg border bg-[#fcfbf8] px-4 py-3', result.revealed ? 'border-warning-200' : 'border-line')}>
        <p className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Sent to the model</p>
        <MaskedText maskedText={result.maskedText} entities={result.entities} labels={labels} revealed={result.revealed} className="text-[13.5px]" />
      </div>

      {result.entities.length ? (
        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={() => setShowTable((value) => !value)}
            aria-expanded={showTable}
            className="flex w-fit items-center gap-1.5 rounded-sm text-[13px] font-medium text-ink-soft hover:text-ink"
          >
            <ChevronDown className={cn('size-3.5 transition-transform motion-reduce:transition-none', showTable ? 'rotate-180' : null)} aria-hidden />
            Detections ({result.entities.length})
          </button>
          {showTable ? <DetectionsTable result={result} labels={labels} /> : null}
          <p className="text-xs text-faint">
            Positions refer to the server's normalised copy of the text, so the masked output above is what counts, not the offsets.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function DetectionsTable({ result, labels }: { result: AnalyzeResult; labels: ReadonlyMap<string, PiiEntityType> }) {
  const sorted = [...result.entities].sort((a, b) => a.start - b.start);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <Table>
        <THead>
          <tr>
            <TH>Type</TH>
            <TH>Placeholder</TH>
            {result.revealed ? <TH>Value</TH> : null}
            <TH className="text-right">Score</TH>
            <TH className="hidden sm:table-cell">Found by</TH>
            <TH className="hidden lg:table-cell">Recognizer</TH>
          </tr>
        </THead>
        <TBody>
          {sorted.map((entity, index) => {
            const tone = entityTone(entity.entityType);
            return (
              <TR key={`${entity.placeholder}:${entity.start}:${index}`}>
                <TD>
                  <span className="flex items-center gap-1.5">
                    <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
                    {labels.get(entity.entityType)?.label ?? humanizeEntityType(entity.entityType)}
                  </span>
                </TD>
                <TD>
                  <code className={cn('rounded border px-1 font-mono text-[11px]', tone.chip)}>{entity.placeholder}</code>
                </TD>
                {result.revealed ? <TD className="max-w-[12rem] truncate font-medium text-ink">{entity.value ?? '—'}</TD> : null}
                <TD className="text-right font-mono text-[12.5px] tabular">{entity.score.toFixed(2)}</TD>
                <TD className="hidden text-muted sm:table-cell">{SOURCE_LABEL[entity.source] ?? entity.source}</TD>
                <TD className="hidden max-w-[16rem] truncate font-mono text-[11px] text-faint lg:table-cell" title={entity.recognizer}>
                  {entity.recognizer}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

/** Spec §8 P3-API-20 and §10: each refusal in its own words. */
function AnalyzeProblem({ error, retryIn, canEdit }: { error: unknown; retryIn: number; canEdit: boolean }) {
  const requestId = isApiError(error) ? error.requestId : undefined;
  if (hasCode(error, 'PII_DETECTION_UNAVAILABLE')) {
    const details = error.details ?? {};
    const types = Array.isArray(details.entityTypes) ? details.entityTypes.filter((type): type is string => typeof type === 'string') : [];
    const hint = typeof details.hint === 'string' ? details.hint : null;
    return (
      <Callout tone="warning" icon={<ShieldAlert className="size-4" />} title="Name detection is unavailable, so the preview was refused">
        The policy says to refuse rather than let names through unmasked
        {types.length ? ` (it needs name detection for ${types.map(humanizeEntityType).join(', ')})` : ''}. Try again once the AI
        service is back.
        {canEdit ? (
          <span className="mt-1.5 block">
            To keep working meanwhile, set “If name detection is unavailable” to “Mask patterns only” above. Names, places and
            organisations then pass through until it's back.
            {hint ? <span className="mt-1 block text-[12.5px] opacity-90">{hint}</span> : null}
          </span>
        ) : null}
        <RequestReference requestId={requestId} className="mt-1 block w-fit" />
      </Callout>
    );
  }
  if (hasCode(error, 'RATE_LIMIT_EXCEEDED')) {
    return (
      <Callout tone="warning" title="Preview limit reached">
        Previews and redaction reports share a budget of 30 a minute.{' '}
        {retryIn > 0 ? <span className="tabular">Try again in {formatCountdown(retryIn)}.</span> : 'You can try again now.'}
      </Callout>
    );
  }
  if (hasCode(error, 'PERMISSION_DENIED')) {
    const missing = Array.isArray(error.details?.missingPermissions) ? error.details.missingPermissions : [];
    return (
      <Callout tone="danger" title="Not allowed">
        {missing.includes('pii:reveal') ? 'Revealing real values needs pii:reveal, which your role doesn’t have.' : messageFor(error)}
        <RequestReference requestId={requestId} className="mt-1 block w-fit" />
      </Callout>
    );
  }
  if (hasCode(error, 'VALIDATION_FAILED')) {
    return (
      <Callout tone="danger" title="The text wasn't accepted">
        {/* The length cap answers with a message only, no field map (spec §6). */}
        {error.message || 'Check the text and try again.'}
      </Callout>
    );
  }
  return (
    <Callout tone="danger" title="The preview didn't run">
      {messageFor(error)} Your text is still here; try again.
      <RequestReference requestId={requestId} className="mt-1 block w-fit" />
    </Callout>
  );
}
