import { CircleCheck, CircleSlash, ShieldCheck, ShieldOff, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { RelativeTime } from '@/components/ui/relative-time';
import type { PiiPolicy } from '@/lib/api/types';
import { formatThreshold, FAILURE_MODE_LABEL } from '@/lib/knowledge/pii-policy';
import { cn, formatDateTime, pluralize } from '@/lib/utils';

const DETECTOR_KIND: Readonly<Record<string, string>> = {
  'ai-service': 'AI service',
  presidio: 'Presidio',
  none: 'None',
};

/**
 * The policy at a glance (spec §5 "Policy view"): on or off, the platform defaults
 * or the workspace's own version, the NER detector, and the server's warnings,
 * which are always shown. Missing server settings are named only to people who can
 * change the policy (spec §10 recovery principles).
 */
export function PolicyStatus({ policy, canEdit }: { policy: PiiPolicy; canEdit: boolean }) {
  const detector = policy.nerDetector;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span
            className={cn(
              'inline-flex size-10 shrink-0 items-center justify-center rounded-xl border',
              policy.enabled ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-warning-200 bg-warning-50 text-warning-700',
            )}
          >
            {policy.enabled ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldOff className="size-5" aria-hidden />}
          </span>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
              Personal-data redaction
              {policy.enabled ? (
                <Badge tone="success" dot>
                  On
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  Off
                </Badge>
              )}
            </h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
              {policy.enabled
                ? `Before any text reaches a model, ${pluralize(policy.entityTypes.length, 'kind')} of personal data ${policy.entityTypes.length === 1 ? 'is' : 'are'} replaced with numbered placeholders such as [PERSON_1]. Documents are stored as uploaded; masking happens at the model boundary.`
                : 'Text reaches models without any masking. Turning redaction off is recorded in the audit log.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
          {policy.source === 'default' ? (
            <Badge tone="outline">Platform defaults · never saved</Badge>
          ) : (
            <Badge tone="brand">Workspace policy · version {policy.version}</Badge>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Last saved">
          {policy.updatedAt ? (
            <span title={formatDateTime(policy.updatedAt)}>
              <RelativeTime value={policy.updatedAt} />
            </span>
          ) : (
            <span className="text-faint">Never</span>
          )}
        </Fact>
        <Fact label="Minimum confidence">
          <span className="font-mono tabular">{formatThreshold(policy.scoreThreshold)}</span>
        </Fact>
        <Fact label="If name detection is down">{FAILURE_MODE_LABEL[policy.onDetectorFailure]}</Fact>
        <Fact label="Name detection">
          <span className="inline-flex items-center gap-1.5">
            {detector.configured ? (
              <CircleCheck className="size-3.5 text-success-600" aria-hidden />
            ) : (
              <CircleSlash className="size-3.5 text-warning-600" aria-hidden />
            )}
            {DETECTOR_KIND[detector.kind] ?? detector.kind}
            <span className="text-muted">{detector.configured ? '· configured' : '· not configured'}</span>
          </span>
        </Fact>
      </dl>

      {policy.warnings.length || (!detector.configured && canEdit && detector.missingConfiguration.length) ? (
        <div className="grid gap-2 border-t border-line px-5 py-4 sm:px-6">
          {policy.warnings.map((warning) => (
            <Callout key={warning} tone="warning" icon={<TriangleAlert className="size-4" aria-hidden />} role="status">
              {warning}
            </Callout>
          ))}
          {!detector.configured && canEdit && detector.missingConfiguration.length ? (
            <p className="text-xs text-muted">
              Missing server settings for name detection:{' '}
              {detector.missingConfiguration.map((setting, index) => (
                <span key={setting}>
                  {index > 0 ? ', ' : null}
                  <code className="rounded bg-well px-1 font-mono text-[11.5px]">{setting}</code>
                </span>
              ))}
              . Someone who runs the deployment can set them.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface px-5 py-3 sm:px-6">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-ink">{children}</dd>
    </div>
  );
}
