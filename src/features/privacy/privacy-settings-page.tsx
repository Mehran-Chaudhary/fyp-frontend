import { Info } from 'lucide-react';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState } from '@/components/feedback/states';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { useDocumentTitle } from '@/lib/hooks';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { useEntityTypes, usePiiPolicy } from '@/features/knowledge/shared/use-pii-policy';
import { PolicyEditor } from './policy-editor';
import { PolicyStatus } from './policy-status';
import { RedactionPreview } from './redaction-preview';

/**
 * Settings → Privacy (Phase 3 spec §5 `/settings/privacy`): the workspace's
 * redaction policy (P3-API-17/18), the entity catalogue (P3-API-19) and a preview of
 * what a model receives (P3-API-20). Reading needs pii:policy:read; editing
 * pii:policy:update; real values pii:reveal.
 */
export function PrivacySettingsPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Privacy');

  if (!can('pii:policy:read')) {
    return (
      <Card>
        <NoAccessState permissions={['pii:policy:read']} workspaceName={workspace.name} title="You can't see the redaction policy" />
      </Card>
    );
  }
  return <Privacy />;
}

function Privacy() {
  const can = useCan();
  const policy = usePiiPolicy();
  const entityTypes = useEntityTypes();

  if (policy.isPending || (entityTypes.isPending && entityTypes.fetchStatus !== 'idle')) {
    return (
      <div className="grid grid-cols-1 gap-6" aria-busy="true">
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }
  if (policy.isError) {
    return (
      <Card>
        <ErrorState error={policy.error} title="We couldn't load the redaction policy" onRetry={() => void policy.refetch()} retrying={policy.isFetching} />
      </Card>
    );
  }

  const editable = can('pii:policy:update') && policy.data.denyList !== null;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PolicyStatus policy={policy.data} canEdit={can('pii:policy:update')} />

      {entityTypes.isError ? (
        <Callout tone="info" icon={<Info className="size-4" />}>
          The entity catalogue didn't load, so types are shown by their code names. The policy itself is unaffected.
        </Callout>
      ) : null}

      <RedactionPreview policy={policy.data} catalogue={entityTypes.list} />

      <section aria-labelledby="policy-heading" className="grid grid-cols-1 gap-4">
        <div>
          <h2 id="policy-heading" className="text-[15px] font-semibold text-ink">
            Policy
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {editable
              ? 'Changes apply to the next request everywhere. Only what you change is sent, with the version you edited.'
              : 'How this workspace masks personal data.'}
          </p>
        </div>
        <PolicyEditor policy={policy.data} catalogue={entityTypes.list} editable={editable} />
      </section>
    </div>
  );
}
