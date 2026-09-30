import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { PageHeader } from '@/components/feedback/states';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Card } from '@/components/ui/card';
import { useDocumentTitle } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { toCreateRequest } from './kb-form-model';
import { kbFormErrors, useCreateKnowledgeBase } from './kb-mutations';
import { KnowledgeBaseForm } from './knowledge-base-form';

/** Create a knowledge base (§6.6, E61). */
export function NewKnowledgeBasePage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('New knowledge base');

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <Link
        to={`/w/${workspace.slug}/knowledge-bases`}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Knowledge bases
      </Link>
      {can('knowledgebase:create') ? (
        <CreateForm />
      ) : (
        <Card>
          <NoAccessState permissions={['knowledgebase:create']} workspaceName={workspace.name} title="You can't create knowledge bases" />
        </Card>
      )}
    </div>
  );
}

function CreateForm() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const create = useCreateKnowledgeBase();
  const [dirty, setDirty] = useState(false);
  const { blocker, allowNavigation } = useUnsavedChanges(dirty);

  return (
    <>
      <PageHeader
        title="New knowledge base"
        description="A compartment for related documents. Restricted bases are invisible to anyone you haven't granted access."
      />
      <KnowledgeBaseForm
        submitLabel="Create knowledge base"
        pending={create.isPending}
        onDirtyChange={setDirty}
        onCancel={() => void navigate(`/w/${workspace.slug}/knowledge-bases`)}
        onSubmit={async (values) => {
          try {
            const created = await create.mutateAsync(toCreateRequest(values));
            allowNavigation();
            toast.success(`Created ${created.name}`, {
              description:
                created.accessMode === 'RESTRICTED'
                  ? 'Only you can see it so far. Grant roles or people access next.'
                  : 'Everyone with document permissions can see it.',
            });
            // A restricted base is invisible to everyone without a grant: go straight to Access (§6.6).
            await navigate(`/w/${workspace.slug}/knowledge-bases/${created.id}${created.accessMode === 'RESTRICTED' ? '/access' : ''}`);
          } catch (error) {
            return kbFormErrors(error);
          }
        }}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}
