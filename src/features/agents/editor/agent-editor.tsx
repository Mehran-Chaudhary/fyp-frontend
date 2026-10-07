import { useMutation } from '@tanstack/react-query';
import { GitCompareArrows, History, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { agentsApi } from '@/lib/api/endpoints';
import { isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { Agent } from '@/lib/api/types';
import {
  AGENT_LIMITS,
  agentPatch,
  changedFormFields,
  createInput,
  createsVersion,
  emptyAgentForm,
  formFromAgent,
  mapServerFieldErrors,
  parseAgentForm,
  patchSections,
  rebaseForm,
  type AgentForm,
  type AgentFormErrors,
  type AgentFormField,
} from '@/lib/agents/agent-form';
import { afterAgentGone, afterAgentSaved } from '@/lib/agents/cache';
import { diffConfigs, lineDiff } from '@/lib/agents/versions';
import { detailList, messageFor } from '@/lib/errors';
import { agentQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { cn, pluralize } from '@/lib/utils';
import { useKnowledgeBases } from '@/features/knowledge/shared/use-knowledge-access';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { EDITOR_SECTIONS, firstSectionWithError, type EditorSectionId } from './editor-model';
import {
  AccessSection,
  AnswersSection,
  IdentitySection,
  InstructionsSection,
  KnowledgeSection,
  MemorySection,
  ModelSection,
  PersonaSection,
  ToolsSection,
} from './editor-sections';

interface EditSession {
  /** The agent the form started from (null when creating). The PATCH is computed against it. */
  base: Agent | null;
  /** The form as it was when loaded, to know what you changed. */
  original: AgentForm;
  form: AgentForm;
}

const sessionFor = (agent: Agent | null): EditSession => {
  const form = agent ? formFromAgent(agent) : emptyAgentForm();
  return { base: agent, original: form, form };
};

/**
 * The builder and editor (§5.2). Create sends only what was filled in; edit sends
 * only the changed sections, `parameters` whole, and `expectedVersion`. A 409 on
 * the version shows what changed on the server and lets you reapply your edits.
 */
export function AgentEditor({ agent }: { agent: Agent | null }) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const knowledgeBases = useKnowledgeBases();
  const [session, setSession] = useState<EditSession>(() => sessionFor(agent));
  const [errors, setErrors] = useState<AgentFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [conflict, setConflict] = useState<Agent | null>(null);
  const creating = session.base === null;

  const { form, original, base } = session;
  const changed = changedFormFields(original, form);
  const dirty = changed.length > 0;

  // A background refetch brought a newer copy (P4-G05: name, description and access are
  // last-write-wins, with no version to guard them). Untouched forms follow it silently.
  const newer = !!agent && !!base && (agent.updatedAt !== base.updatedAt || agent.currentVersion !== base.currentVersion);
  if (newer && !dirty && !conflict) setSession(sessionFor(agent));
  const staleWhileDirty = newer && dirty && !conflict;

  const { blocker, allowNavigation } = useUnsavedChanges(dirty);

  const set = <K extends AgentFormField>(key: K, value: AgentForm[K]) => {
    setSession((current) => ({ ...current, form: { ...current.form, [key]: value } }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const parsed = parseAgentForm(form);
  const patch = base && parsed.draft ? agentPatch(base, parsed.draft, changeNote) : null;
  const versioned = !!patch && createsVersion(patch);

  const focusSection = (id: EditorSectionId | null) => {
    if (!id) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const applyServerError = async (error: unknown) => {
    if (!isApiError(error)) {
      setFormError(messageFor(error));
      return;
    }
    const next: AgentFormErrors = {};
    switch (error.code) {
      case 'AGENT_NAME_TAKEN':
        next.name = 'Another agent already has this name. Names are unique, ignoring case.';
        break;
      case 'KNOWLEDGE_BASE_NOT_FOUND': {
        const gone = typeof error.details?.knowledgeBaseId === 'string' ? error.details.knowledgeBaseId : null;
        next.knowledgeBaseIds = "One of these knowledge bases isn't available to you any more. It was removed from the list; review and save again.";
        if (gone) set('knowledgeBaseIds', form.knowledgeBaseIds.filter((id) => id !== gone));
        void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
        break;
      }
      case 'ROLE_NOT_FOUND': {
        const gone = detailList(error, 'roleIds');
        next.allowedRoleIds = 'Some of these roles no longer exist. They were removed; review and save again.';
        if (gone.length) set('allowedRoleIds', form.allowedRoleIds.filter((id) => !gone.includes(id)));
        void queryClient.invalidateQueries({ queryKey: queryKeys.roles(workspace.id) });
        break;
      }
      case 'LLM_MODEL_NOT_ALLOWED':
      case 'LLM_MODEL_NOT_FOUND':
        next.model = messageFor(error);
        void queryClient.invalidateQueries({ queryKey: queryKeys.llm(workspace.id) });
        break;
      case 'TOOL_NOT_FOUND':
      case 'TOOL_DISABLED':
        next.toolIds = 'A selected tool was removed or disabled. Review the grants before saving again.';
        void queryClient.invalidateQueries({ queryKey: ['ws', workspace.id, 'tools'] });
        break;
      case 'VALIDATION_FAILED': {
        const mapped = mapServerFieldErrors(error.fieldErrors());
        Object.assign(next, mapped.errors);
        if (mapped.rest.length || Object.keys(mapped.errors).length === 0) setFormError(mapped.rest.join(' ') || error.message);
        break;
      }
      case 'AGENT_VERSION_CONFLICT': {
        if (!base) break;
        try {
          const latest = await queryClient.fetchQuery({ ...agentQuery(workspace.id, base.id), staleTime: 0 });
          setConflict(latest);
        } catch (refetchError) {
          setFormError(messageFor(refetchError));
        }
        return;
      }
      case 'AGENT_NOT_FOUND':
        if (base) void afterAgentGone(workspace.id, base.id);
        setFormError("This agent doesn't exist any more or isn't available to you.");
        return;
      default:
        setFormError(messageFor(error));
    }
    if (Object.keys(next).length) {
      setErrors(next);
      focusSection(firstSectionWithError(next));
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!parsed.draft) throw new Error('invalid');
      if (!base) return agentsApi.create(workspace.id, createInput(parsed.draft));
      if (!patch) return base;
      return agentsApi.update(workspace.id, base.id, patch);
    },
    onSuccess: (saved) => {
      void afterAgentSaved(workspace.id, saved, base?.currentVersion);
      setChangeNote('');
      setErrors({});
      setFormError(null);
      if (!base) {
        allowNavigation();
        toast.success(`${saved.name} created`, { description: 'A private draft at version 1. Preview its prompt, then publish it.' });
        navigate(`/w/${workspace.slug}/agents/${saved.id}`, { state: { created: true } });
        return;
      }
      setSession(sessionFor(saved));
      toast.success(saved.currentVersion !== base.currentVersion ? `Saved as version ${saved.currentVersion}` : 'Saved', {
        description: saved.currentVersion !== base.currentVersion ? undefined : 'Name, description and access changes create no version.',
      });
    },
    onError: async (error) => {
      if (isOutcomeUnknown(error)) {
        // The save may have happened: read the agent back instead of repeating it.
        if (!base) {
          setFormError(`${messageFor(error)} Check the agents list for “${form.name.trim()}” before creating it again.`);
          void queryClient.invalidateQueries({ queryKey: queryKeys.agents(workspace.id) });
          return;
        }
        try {
          const latest = await queryClient.fetchQuery({ ...agentQuery(workspace.id, base.id), staleTime: 0 });
          if (parsed.draft && agentPatch(latest, parsed.draft) === null) {
            void afterAgentSaved(workspace.id, latest, base.currentVersion);
            setSession(sessionFor(latest));
            toast.success('Saved', { description: "The answer was lost on the way back, but your changes are on the server." });
            return;
          }
          setFormError(`${messageFor(error)} Your changes weren't saved; try again.`);
        } catch {
          setFormError(`${messageFor(error)} We couldn't check whether your changes were saved. Reload before trying again.`);
        }
        return;
      }
      await applyServerError(error);
    },
  });

  const submit = () => {
    setFormError(null);
    if (parsed.draft === null) {
      setErrors(parsed.errors);
      focusSection(firstSectionWithError(parsed.errors));
      return;
    }
    if (!creating && !patch) return;
    save.mutate();
  };

  const reapply = (latest: Agent) => {
    const current = formFromAgent(latest);
    setSession({ base: latest, original: current, form: rebaseForm(original, current, form) });
    setConflict(null);
    toast.message('Your edits are applied on top of the latest version', { description: 'Review them, then save again.' });
  };
  const discardMine = (latest: Agent) => {
    setSession(sessionFor(latest));
    setConflict(null);
    setErrors({});
  };

  const sectionState = (fields: readonly AgentFormField[]) => ({
    error: fields.some((field) => errors[field]),
    changed: !creating && fields.some((field) => changed.includes(field)),
  });

  const sectionProps = { form, set, errors, disabled: save.isPending };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <nav aria-label="Editor sections" className="hidden lg:block">
        <ul className="sticky top-20 grid gap-0.5">
          {EDITOR_SECTIONS.map((section) => {
            const state = sectionState(section.fields);
            const Icon = section.icon;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => focusSection(section.id)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink-soft hover:bg-well hover:text-ink"
                >
                  <Icon className="size-3.5 text-faint" aria-hidden />
                  <span className="flex-1 truncate">{section.label}</span>
                  {state.error ? (
                    <span className="size-1.5 rounded-full bg-danger-500" aria-label="Has errors" />
                  ) : state.changed ? (
                    <span className="size-1.5 rounded-full bg-brand-500" aria-label="Changed" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <form
        noValidate
        className="grid min-w-0 gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {conflict && base ? <ConflictPanel base={base} latest={conflict} knowledgeBaseName={(id) => knowledgeBases.byId.get(id)?.name} onReapply={() => reapply(conflict)} onDiscard={() => discardMine(conflict)} /> : null}
        {staleWhileDirty && agent ? (
          <Callout
            tone="warning"
            title="This agent changed since you opened it"
            action={
              <Button
                variant="secondary"
                size="xs"
                onClick={() => {
                  const current = formFromAgent(agent);
                  setSession({ base: agent, original: current, form: rebaseForm(original, current, form) });
                }}
              >
                <RotateCcw />
                Load the latest and keep my edits
              </Button>
            }
          >
            Someone saved it {agent.currentVersion !== base?.currentVersion ? `(now version ${agent.currentVersion}) ` : ''}while you were editing.
            Load the latest so your save doesn't undo their name, description or access changes.
          </Callout>
        ) : null}

        <IdentitySection {...sectionProps} />
        <PersonaSection {...sectionProps} />
        <InstructionsSection {...sectionProps} />
        <KnowledgeSection {...sectionProps} hiddenKnowledgeBases={base?.config.retrieval.hiddenKnowledgeBases ?? 0} />
        <ModelSection {...sectionProps} />
        <MemorySection {...sectionProps} />
        <AnswersSection {...sectionProps} />
        <AccessSection {...sectionProps} />
        <ToolsSection {...sectionProps} />

        <SaveBar sticky={creating || dirty}>
          <div className="min-w-0 flex-1 text-[13px]">
            {creating ? (
              <p className="text-muted">New agents start as private drafts at version 1. Only the fields you filled in are sent.</p>
            ) : !dirty ? (
              <p className="text-muted">No unsaved changes · version {base?.currentVersion}</p>
            ) : (
              <p className="text-ink-soft">
                <span className="font-medium text-ink">Unsaved changes</span>
                {patch ? ` · ${patchSections(patch).join(', ')}` : null}
                {patch ? (
                  versioned ? (
                    <span className="text-brand-700"> · Saving will create version {(base?.currentVersion ?? 0) + 1}</span>
                  ) : (
                    <span className="text-muted"> · No new version: identity and access only</span>
                  )
                ) : !parsed.draft ? (
                  <span className="text-danger-700"> · Fix the highlighted fields</span>
                ) : null}
              </p>
            )}
            {versioned ? (
              <Input
                className="mt-2 max-w-md"
                inputClassName="h-8 text-[13px]"
                value={changeNote}
                onChange={(event) => setChangeNote(event.target.value)}
                maxLength={AGENT_LIMITS.changeNote}
                placeholder="Change note, like a commit message (optional)"
                aria-label="Change note"
              />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!creating && dirty ? (
              <Button variant="ghost" onClick={() => setSession((current) => ({ ...current, form: current.original }))} disabled={save.isPending}>
                Discard
              </Button>
            ) : null}
            <Button type="submit" loading={save.isPending} disabled={!creating && !dirty}>
              {save.isPending ? null : <Save />}
              {creating ? 'Create agent' : 'Save changes'}
            </Button>
          </div>
        </SaveBar>
        <FormError message={formError ?? undefined} />
      </form>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

function SaveBar({ children, sticky }: { children: ReactNode; sticky: boolean }) {
  return (
    <div
      className={cn(
        'z-10 -mx-1 flex flex-col gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:flex-row sm:items-center',
        sticky ? 'sticky bottom-3 shadow-pop' : 'shadow-card',
      )}
    >
      {children}
    </div>
  );
}

/** 409 AGENT_VERSION_CONFLICT (§5.2): what changed on the server, and the way back to saving. */
function ConflictPanel({
  base,
  latest,
  knowledgeBaseName,
  onReapply,
  onDiscard,
}: {
  base: Agent;
  latest: Agent;
  knowledgeBaseName: (id: string) => string | undefined;
  onReapply: () => void;
  onDiscard: () => void;
}) {
  const changes = diffConfigs(base.config, latest.config, { knowledgeBaseName });
  const identity: Array<{ label: string; before: string; after: string }> = [];
  if (base.name !== latest.name) identity.push({ label: 'Name', before: base.name, after: latest.name });
  if (base.description !== latest.description) identity.push({ label: 'Description', before: base.description ?? '—', after: latest.description ?? '—' });
  if (base.accessMode !== latest.accessMode) identity.push({ label: 'Access', before: base.accessMode, after: latest.accessMode });
  const instructions = base.instructions !== latest.instructions ? lineDiff(base.instructions, latest.instructions) : [];
  const total = changes.length + identity.length + (instructions.length ? 1 : 0);

  return (
    <section className="animate-rise rounded-xl border border-warning-200 bg-warning-50/60 shadow-card" role="alert">
      <header className="flex items-start gap-3 px-5 pt-4 pb-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-600" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-ink">Someone saved version {latest.currentVersion} while you were editing</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">
            You started from version {base.currentVersion}. Nothing of yours was saved. {total ? `They changed ${pluralize(total, 'setting')}:` : 'Their changes are listed in Versions.'}
          </p>
        </div>
      </header>
      {total ? (
        <div className="mx-5 mb-4 overflow-hidden rounded-lg border border-line bg-surface">
          <ul className="divide-y divide-line/70 text-[12.5px]">
            {[...identity, ...changes].map((row) => (
              <li key={row.label} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <span className="text-muted">{row.label}</span>
                <span className="min-w-0 break-words">
                  <del className="text-faint">{row.before}</del> <span aria-hidden>→</span> <ins className="text-ink no-underline">{row.after}</ins>
                </span>
              </li>
            ))}
            {instructions.length ? (
              <li className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <span className="text-muted">Instructions</span>
                <span>
                  {instructions.filter((line) => line.type === 'add').length} lines added, {instructions.filter((line) => line.type === 'del').length} removed
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <footer className="flex flex-wrap items-center gap-2 border-t border-warning-200 px-5 py-3">
        <Button size="sm" onClick={onReapply}>
          <GitCompareArrows />
          Re-apply my changes on top
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          <History />
          Discard mine, load theirs
        </Button>
        <p className={cn('text-[12px] text-muted', 'basis-full sm:basis-auto')}>Settings you changed keep your value; everything else takes theirs.</p>
      </footer>
    </section>
  );
}
