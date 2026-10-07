import { useQuery } from '@tanstack/react-query';
import { BookOpenText, Brain, Cpu, Fingerprint, Lock, MessageSquareQuote, Plus, ScrollText, Search, ShieldCheck, Users, Wrench, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Checkbox, CheckboxBox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Segmented } from '@/components/ui/segmented';
import { Select, type SelectOption } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AGENT_LIMITS, PLATFORM_MAX_MESSAGES, TONES, type AgentForm, type AgentFormErrors, type AgentFormField } from '@/lib/agents/agent-form';
import type { EditorSectionId } from './editor-model';
import { TONE_LABEL } from '@/lib/agents/versions';
import type { Classification, KnowledgeBase, LlmModel, LlmPolicy } from '@/lib/api/types';
import { llmModelsQuery, llmPolicyQuery, rolesQuery } from '@/lib/queries';
import { cn, pluralize } from '@/lib/utils';
import { ClassificationBadge } from '@/features/knowledge/shared/badges';
import { KnowledgeBaseName } from '@/features/knowledge/shared/kb-identity';
import { CLASSIFICATION_META } from '@/features/knowledge/shared/meta';
import { useKnowledgeBases } from '@/features/knowledge/shared/use-knowledge-access';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useAgentCan } from '../shared/use-agent-can';
import { ToolGrantPicker } from '@/features/tools/tool-grant-picker';

export interface SectionProps {
  form: AgentForm;
  set: <K extends AgentFormField>(key: K, value: AgentForm[K]) => void;
  errors: AgentFormErrors;
  disabled?: boolean;
}

function Section({ id, title, description, icon, children, aside }: { id: EditorSectionId; title: string; description?: ReactNode; icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card id={`section-${id}`} className="scroll-mt-24">
      <header className="flex items-start gap-3 px-5 pt-5 pb-4 sm:px-6">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-well text-ink-soft [&_svg]:size-4">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] leading-6 font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p> : null}
        </div>
        {aside}
      </header>
      <div className="grid gap-4 px-5 pb-5 sm:px-6">{children}</div>
    </Card>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return <span className={cn('text-xs tabular', value > max ? 'text-danger-700' : 'text-faint')}>{value.toLocaleString()}/{max.toLocaleString()}</span>;
}

/** A number box that keeps what was typed until the form is parsed. */
function NumberField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  step,
  disabled,
  className,
  optional,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  placeholder?: string;
  step?: number | 'any';
  disabled?: boolean;
  className?: string;
  optional?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={hint} className={className} optional={optional}>
      <Input
        type="number"
        inputMode="decimal"
        step={step ?? 'any'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputClassName="font-mono tabular"
      />
    </Field>
  );
}

// ── Identity ────────────────────────────────────────────────────────────────

export function IdentitySection({ form, set, errors, disabled }: SectionProps) {
  return (
    <Section id="identity" title="Identity" icon={<Fingerprint />} description="Names are unique in the workspace, ignoring case. Editing them never creates a version.">
      <Field label="Name" error={errors.name} labelAside={<Counter value={form.name.trim().length} max={AGENT_LIMITS.name} />}>
        <Input value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="HR Policy Assistant" disabled={disabled} autoComplete="off" />
      </Field>
      <Field label="Description" optional error={errors.description} labelAside={<Counter value={form.description.trim().length} max={AGENT_LIMITS.description} />}>
        <Textarea
          value={form.description}
          onChange={(event) => set('description', event.target.value)}
          rows={3}
          placeholder="Answers leave and HR questions from the Company Handbook."
          disabled={disabled}
        />
      </Field>
    </Section>
  );
}

// ── Persona ─────────────────────────────────────────────────────────────────

export function PersonaSection({ form, set, errors, disabled }: SectionProps) {
  const name = form.name.trim() || 'the agent';
  return (
    <Section id="persona" title="Persona" icon={<MessageSquareQuote />} description="How it introduces itself and how it sounds.">
      <Field
        label="Role"
        optional
        error={errors.role}
        hint={<>The system prompt opens “You are {name}, {form.role.trim() || 'an assistant for this organisation'}.”</>}
        labelAside={<Counter value={form.role.trim().length} max={AGENT_LIMITS.role} />}
      >
        <Input value={form.role} onChange={(event) => set('role', event.target.value)} placeholder="the HR policy assistant" disabled={disabled} />
      </Field>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium text-ink-soft">Tone</span>
        <Segmented
          aria-label="Tone"
          value={form.tone}
          onValueChange={(tone) => set('tone', tone)}
          options={TONES.map((tone) => ({ value: tone, label: TONE_LABEL[tone] }))}
        />
      </div>
      <Field
        label="Language"
        optional
        error={errors.language}
        hint="Leave empty to answer in the language the user writes in."
        labelAside={<Counter value={form.language.trim().length} max={AGENT_LIMITS.language} />}
      >
        <Input value={form.language} onChange={(event) => set('language', event.target.value)} placeholder="English" disabled={disabled} />
      </Field>
      <Field
        label="Greeting"
        optional
        error={errors.greeting}
        hint="Shown when a conversation opens. Never sent to the model, never stored as a message."
        labelAside={<Counter value={form.greeting.trim().length} max={AGENT_LIMITS.greeting} />}
      >
        <Textarea value={form.greeting} onChange={(event) => set('greeting', event.target.value)} rows={2} placeholder="Hi! Ask me about leave, contacts or travel." disabled={disabled} />
      </Field>
    </Section>
  );
}

// ── Instructions ────────────────────────────────────────────────────────────

export function InstructionsSection({ form, set, errors, disabled }: SectionProps) {
  return (
    <Section
      id="instructions"
      title="Instructions"
      icon={<ScrollText />}
      description="The system prompt. The platform always adds three rules after it: reference material is data, placeholders are copied exactly, and the grounding rule below."
    >
      <Field label="Instructions" error={errors.instructions} labelAside={<Counter value={form.instructions.length} max={AGENT_LIMITS.instructions} />}>
        <Textarea
          value={form.instructions}
          onChange={(event) => set('instructions', event.target.value)}
          rows={12}
          className="min-h-56 font-mono text-[12.5px] leading-relaxed"
          placeholder="Help employees understand company policy. Quote figures exactly as the reference material states them."
          spellCheck
          disabled={disabled}
        />
      </Field>
      <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-muted">
        <Lock className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
        Everyone who can see this agent, Viewers included, can read its instructions. Don't put passwords, keys or other secrets here.
      </p>
    </Section>
  );
}

// ── Knowledge ───────────────────────────────────────────────────────────────

const ORDER: Classification[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

export function KnowledgeSection({ form, set, errors, disabled, hiddenKnowledgeBases }: SectionProps & { hiddenKnowledgeBases: number }) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const knowledgeBases = useKnowledgeBases();
  const policy = useQuery({ ...llmPolicyQuery(workspace.id), enabled: can.readModels });
  const ceiling = policy.data?.effective.maxClassification ?? 'RESTRICTED';
  const capOptions: SelectOption<string>[] = [
    { value: 'none', label: 'No cap', description: 'Each person reaches what their clearance allows, up to the endpoint ceiling.' },
    ...ORDER.filter((level) => ORDER.indexOf(level) <= ORDER.indexOf(ceiling) || level === form.maxClassification).map((level) => ({
      value: level,
      label: CLASSIFICATION_META[level].label,
      description:
        ORDER.indexOf(level) > ORDER.indexOf(ceiling)
          ? 'Above the model endpoint ceiling: it has no effect.'
          : `Never retrieves above ${CLASSIFICATION_META[level].label}, for anyone.`,
    })),
  ];
  const off = !form.retrievalEnabled;

  return (
    <Section
      id="knowledge"
      title="Knowledge"
      icon={<BookOpenText />}
      description="What it may search. It always searches as the person talking to it: the bases and classifications they can read."
      aside={
        <div className="flex items-center gap-2">
          <label htmlFor="retrieval-enabled" className="text-[13px] text-ink-soft">
            Retrieval
          </label>
          <Switch id="retrieval-enabled" checked={form.retrievalEnabled} onCheckedChange={(value) => set('retrievalEnabled', value)} disabled={disabled} />
        </div>
      }
    >
      {off ? <Callout tone="neutral">Retrieval is off: it never searches documents and answers from instructions and memory only.</Callout> : null}
      <div className={cn('grid gap-4', off && 'pointer-events-none opacity-55')} aria-disabled={off || undefined}>
        {can.readKnowledgeBases ? (
          <KnowledgeBasePicker
            list={knowledgeBases.list}
            loading={knowledgeBases.isPending}
            selected={form.knowledgeBaseIds}
            onChange={(ids) => set('knowledgeBaseIds', ids)}
            error={errors.knowledgeBaseIds}
            disabled={disabled || off}
          />
        ) : (
          <Callout tone="neutral">Choosing knowledge bases needs the knowledgebase:read permission.</Callout>
        )}
        {hiddenKnowledgeBases > 0 ? (
          <p className="rounded-lg border border-line bg-well/60 px-3 py-2 text-[12.5px] leading-snug text-ink-soft">
            Also uses {pluralize(hiddenKnowledgeBases, 'knowledge base')} you don't have access to. Saving keeps {hiddenKnowledgeBases === 1 ? 'it' : 'them'} attached.
          </p>
        ) : null}
        {form.knowledgeBaseIds.length === 0 && hiddenKnowledgeBases === 0 ? (
          <p className="text-[12.5px] text-muted">With no knowledge base attached, no retrieval runs.</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Passages" value={form.retrievalTopK} onChange={(value) => set('retrievalTopK', value)} error={errors.retrievalTopK} hint="1–20" step={1} disabled={disabled} />
          <NumberField
            label="Passage budget"
            value={form.maxContextTokens}
            onChange={(value) => set('maxContextTokens', value)}
            error={errors.maxContextTokens}
            hint="Tokens, 0–65,536"
            step={1}
            disabled={disabled}
          />
          <Field label="Classification cap" error={errors.maxClassification}>
            <Select
              value={form.maxClassification ?? 'none'}
              onValueChange={(value) => set('maxClassification', value === 'none' ? null : (value as Classification))}
              options={capOptions}
              disabled={disabled}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Search mode</span>
            <Segmented
              aria-label="Search mode"
              value={form.retrievalMode}
              onValueChange={(mode) => set('retrievalMode', mode)}
              options={[
                { value: 'hybrid', label: 'Keyword + meaning' },
                { value: 'dense', label: 'Meaning only' },
              ]}
            />
          </div>
          {form.retrievalMode === 'dense' ? (
            <NumberField
              label="Minimum similarity"
              optional
              value={form.minScore}
              onChange={(value) => set('minScore', value)}
              error={errors.minScore}
              placeholder="None"
              className="w-40"
              disabled={disabled}
            />
          ) : null}
          <Checkbox
            className="pb-2"
            checked={form.rerank}
            onCheckedChange={(value) => set('rerank', value)}
            label="Rerank passages"
            description="Slower, often more precise. Off by default for agents."
            disabled={disabled}
          />
        </div>
        {policy.data && policy.data.effective.maxClassification !== 'RESTRICTED' ? (
          <p className="text-[12.5px] leading-snug text-muted">
            The model endpoint's ceiling is <ClassificationBadge classification={policy.data.effective.maxClassification} />: nothing above it is
            ever retrieved for any agent.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function KnowledgeBasePicker({
  list,
  loading,
  selected,
  onChange,
  error,
  disabled,
}: {
  list: KnowledgeBase[];
  loading: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const id = useId();
  const chosen = new Set(selected);
  const unknown = selected.filter((knowledgeBaseId) => !list.some((knowledgeBase) => knowledgeBase.id === knowledgeBaseId));
  const visible = list.filter((knowledgeBase) => knowledgeBase.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (knowledgeBaseId: string, on: boolean) =>
    onChange(on ? [...selected, knowledgeBaseId] : selected.filter((item) => item !== knowledgeBaseId));

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={id} className="text-[13px] font-medium text-ink-soft">
          Knowledge bases
        </span>
        <span className="text-xs text-faint tabular">
          {selected.length}/{AGENT_LIMITS.knowledgeBases}
        </span>
      </div>
      {list.length > 8 ? (
        <Input value={filter} onChange={(event) => setFilter(event.target.value)} leading={<Search />} placeholder="Filter by name" inputClassName="h-9" aria-label="Filter knowledge bases" />
      ) : null}
      <div role="group" aria-labelledby={id} className="scrollbar-thin max-h-64 overflow-y-auto rounded-lg border border-line">
        {loading ? (
          <p className="px-3 py-3 text-[13px] text-muted">Loading knowledge bases…</p>
        ) : list.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-muted">You can't read any knowledge base yet. Only bases you can read can be attached.</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-muted">No knowledge base matches.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {visible.map((knowledgeBase) => (
              <li key={knowledgeBase.id}>
                <label className={cn('flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-well/50', disabled && 'cursor-not-allowed')}>
                  <CheckboxBox
                    checked={chosen.has(knowledgeBase.id)}
                    onCheckedChange={(on) => toggle(knowledgeBase.id, on)}
                    disabled={disabled || (!chosen.has(knowledgeBase.id) && selected.length >= AGENT_LIMITS.knowledgeBases)}
                    aria-label={knowledgeBase.name}
                  />
                  <KnowledgeBaseName knowledgeBase={knowledgeBase} className="min-w-0 flex-1 text-[13px] text-ink-soft" />
                  <span className="shrink-0 font-mono text-[11.5px] text-faint tabular">{pluralize(knowledgeBase.stats.ready, 'doc')}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {unknown.length ? (
        <p className="text-[12.5px] text-muted">
          {pluralize(unknown.length, 'selected base')} isn't in your list any more.{' '}
          <Button variant="link" size="xs" className="text-[12.5px]" onClick={() => onChange(selected.filter((item) => !unknown.includes(item)))}>
            Remove
          </Button>
        </p>
      ) : null}
      {error ? (
        <p className="text-[13px] text-danger-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── Model ───────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = '__workspace_default__';

export function ModelSection({ form, set, errors, disabled }: SectionProps) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const models = useQuery({ ...llmModelsQuery(workspace.id), enabled: can.readModels });
  const policy = useQuery({ ...llmPolicyQuery(workspace.id), enabled: can.readModels });
  const [advanced, setAdvanced] = useState(() => !!(form.topP || form.topK || form.repeatPenalty || form.seed || form.stop.length || form.contextWindow));
  const options = modelOptions(models.data?.models ?? [], policy.data, form.model);
  const current = form.model ? models.data?.models.find((model) => model.name === form.model) : undefined;
  const notAllowed = !!form.model && !!models.data && (!current || !current.allowed);
  const ceiling = policy.data?.effective.maxOutputTokens;

  return (
    <Section id="model" title="Model" icon={<Cpu />} description="Which model answers, and how it samples. Empty fields use the platform defaults.">
      <Field label="Model" error={errors.model} hint={models.data && !models.data.verified ? "Couldn't confirm with the model server: this list comes from configuration." : undefined}>
        <Select
          value={form.model ?? DEFAULT_MODEL}
          onValueChange={(value) => set('model', value === DEFAULT_MODEL ? null : value)}
          options={options}
          disabled={disabled || !can.readModels}
          placeholder={models.isPending ? 'Loading models…' : 'Choose a model'}
        />
      </Field>
      {notAllowed ? (
        <Callout tone="warning">
          {form.model} isn't allowed in this workspace now. Turns will fail with “model not allowed” until you choose another one.
        </Callout>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Temperature"
          optional
          value={form.temperature}
          onChange={(value) => set('temperature', value)}
          error={errors.temperature}
          hint="0–2. Lower is steadier; policy answers do well around 0.2."
          placeholder="Default"
          disabled={disabled}
        />
        <NumberField
          label="Max answer length"
          optional
          value={form.maxOutputTokens}
          onChange={(value) => set('maxOutputTokens', value)}
          error={errors.maxOutputTokens}
          hint={ceiling ? `Tokens. This workspace caps answers at ${ceiling.toLocaleString()}; more is clamped, not refused.` : 'Tokens, clamped to the workspace ceiling.'}
          placeholder="Default"
          step={1}
          disabled={disabled}
        />
      </div>
      <button
        type="button"
        onClick={() => setAdvanced((value) => !value)}
        className="w-fit rounded-sm text-[13px] font-medium text-brand-700 hover:underline hover:underline-offset-4"
        aria-expanded={advanced}
      >
        {advanced ? 'Hide advanced settings' : 'Advanced settings'}
      </button>
      {advanced ? (
        <div className="grid gap-4 rounded-lg border border-line bg-well/35 p-4 sm:grid-cols-2">
          <NumberField label="Top P" optional value={form.topP} onChange={(value) => set('topP', value)} error={errors.topP} hint="0.01–1" placeholder="Default" disabled={disabled} />
          <NumberField label="Seed" optional value={form.seed} onChange={(value) => set('seed', value)} error={errors.seed} hint="A whole number, for repeatable sampling." placeholder="Random" step={1} disabled={disabled} />
          <NumberField label="Top K" optional value={form.topK} onChange={(value) => set('topK', value)} error={errors.topK} hint="1–500. Ollama models only." placeholder="Default" step={1} disabled={disabled} />
          <NumberField label="Repeat penalty" optional value={form.repeatPenalty} onChange={(value) => set('repeatPenalty', value)} error={errors.repeatPenalty} hint="0.5–2. Ollama models only." placeholder="Default" disabled={disabled} />
          <NumberField
            label="Context window cap"
            optional
            value={form.contextWindow}
            onChange={(value) => set('contextWindow', value)}
            error={errors.contextWindow}
            hint="512–1,048,576 tokens. Empty uses the model's own, within the platform and workspace ceilings."
            placeholder="Model's own"
            step={1}
            disabled={disabled}
          />
          <StopSequences value={form.stop} onChange={(value) => set('stop', value)} error={errors.stop} disabled={disabled} />
        </div>
      ) : null}
    </Section>
  );
}

function modelOptions(models: LlmModel[], policy: LlmPolicy | undefined, current: string | null): SelectOption<string>[] {
  const allowed = models.filter((model) => model.allowed);
  const options: SelectOption<string>[] = [
    {
      value: DEFAULT_MODEL,
      label: 'Workspace default',
      description: policy ? `Currently ${policy.effective.defaultModel}. Follows the default at every turn.` : 'Follows the default at every turn.',
    },
    ...allowed.map((model) => ({
      value: model.name,
      label: <span className="font-mono text-[12.5px]">{model.name}</span>,
      description: [model.family, model.contextLength ? `${model.contextLength.toLocaleString()} tokens` : null, model.isDefault ? 'workspace default' : null]
        .filter(Boolean)
        .join(' · '),
    })),
  ];
  if (current && !allowed.some((model) => model.name === current)) {
    options.push({ value: current, label: <span className="font-mono text-[12.5px]">{current}</span>, description: 'Not allowed any more' });
  }
  return options;
}

function StopSequences({ value, onChange, error, disabled }: { value: string[]; onChange: (value: string[]) => void; error?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const full = value.length >= AGENT_LIMITS.stopSequences;
  const add = () => {
    if (!draft || full || value.includes(draft) || draft.length > AGENT_LIMITS.stopLength) return;
    onChange([...value, draft]);
    setDraft('');
  };
  return (
    <Field label="Stop sequences" optional error={error} hint={`Up to ${AGENT_LIMITS.stopSequences}, each up to ${AGENT_LIMITS.stopLength} characters. Spaces count.`}>
      <div className="grid gap-2">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            maxLength={AGENT_LIMITS.stopLength}
            placeholder={full ? 'Limit reached' : 'e.g. ###'}
            disabled={disabled || full}
            inputClassName="font-mono"
          />
          <Button variant="secondary" onClick={add} disabled={disabled || full || !draft} aria-label="Add stop sequence">
            <Plus />
          </Button>
        </div>
        {value.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {value.map((item) => (
              <li key={item}>
                <span className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface py-px pr-0.5 pl-1.5 font-mono text-[12px] text-ink-soft">
                  {JSON.stringify(item)}
                  <button type="button" className="rounded p-0.5 text-faint hover:bg-well hover:text-ink" onClick={() => onChange(value.filter((entry) => entry !== item))} aria-label={`Remove ${item}`} disabled={disabled}>
                    <X className="size-3" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}

// ── Memory ──────────────────────────────────────────────────────────────────

export function MemorySection({ form, set, errors, disabled }: SectionProps) {
  const messages = Number(form.maxMessages);
  return (
    <Section id="memory" title="Memory" icon={<Brain />} description="How much of the conversation it sees with each new question. Newest first, as one unbroken block.">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Messages remembered"
          value={form.maxMessages}
          onChange={(value) => set('maxMessages', value)}
          error={errors.maxMessages}
          hint={
            Number.isFinite(messages) && messages > PLATFORM_MAX_MESSAGES
              ? `The platform caps it at ${PLATFORM_MAX_MESSAGES}.`
              : messages === 0
                ? '0 turns memory off: every question stands alone.'
                : '0–500. Only complete messages you can still read count.'
          }
          step={1}
          disabled={disabled}
        />
        <NumberField
          label="History budget"
          value={form.maxHistoryTokens}
          onChange={(value) => set('maxHistoryTokens', value)}
          error={errors.maxHistoryTokens}
          hint="Tokens, 0–262,144. History fills what's left after instructions and passages."
          step={1}
          disabled={disabled}
        />
      </div>
    </Section>
  );
}

// ── Answers ─────────────────────────────────────────────────────────────────

export function AnswersSection({ form, set, disabled }: SectionProps) {
  return (
    <Section id="answers" title="Answers" icon={<ShieldCheck />} description="How closely it sticks to the documents it was given.">
      <RadioGroup
        value={form.grounding}
        onValueChange={(value) => set('grounding', value)}
        variant="cards"
        disabled={disabled}
        options={[
          { value: 'STRICT', label: 'Strict', description: 'Answers only from retrieved material, and says it does not know otherwise.' },
          { value: 'BALANCED', label: 'Balanced', description: 'May add general knowledge, and says when it does.' },
        ]}
      />
      <Checkbox
        checked={form.citations}
        onCheckedChange={(value) => set('citations', value)}
        label="Cite sources"
        description="Asks the model to mark claims with [S1], [S2]…, which link to the documents in the chat."
        disabled={disabled}
      />
    </Section>
  );
}

// ── Access ──────────────────────────────────────────────────────────────────

export function AccessSection({ form, set, errors, disabled }: SectionProps) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const roles = useQuery({ ...rolesQuery(workspace.id), enabled: can.readRoles });
  const chosen = new Set(form.allowedRoleIds);
  const unknown = form.allowedRoleIds.filter((id) => roles.data && !roles.data.some((role) => role.id === id));

  return (
    <Section
      id="access"
      title="Access"
      icon={<Users />}
      description="Who may talk to it once it's published. This decides who can chat, not what it can read: it reads only what each person can read."
    >
      <RadioGroup
        value={form.accessMode}
        onValueChange={(value) => set('accessMode', value)}
        variant="cards"
        disabled={disabled}
        options={[
          { value: 'WORKSPACE', label: 'Everyone who can use agents', description: 'Every member holding agent:execute.' },
          { value: 'RESTRICTED', label: 'Only some roles', description: 'Members holding one of the roles below. API keys can never use it.' },
        ]}
      />
      {form.accessMode === 'RESTRICTED' ? (
        can.readRoles ? (
          <div className="grid gap-2">
            <span className="text-[13px] font-medium text-ink-soft">Allowed roles</span>
            {roles.isPending ? (
              <p className="text-[13px] text-muted">Loading roles…</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {(roles.data ?? []).map((role) => (
                  <li key={role.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors',
                        chosen.has(role.id) ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-line-strong bg-surface text-ink-soft hover:bg-well/60',
                      )}
                    >
                      <CheckboxBox
                        checked={chosen.has(role.id)}
                        onCheckedChange={(on) =>
                          set('allowedRoleIds', on ? [...form.allowedRoleIds, role.id] : form.allowedRoleIds.filter((id) => id !== role.id))
                        }
                        disabled={disabled}
                        className="mt-0"
                      />
                      {role.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {unknown.length ? (
              <p className="text-[12.5px] text-muted">
                {pluralize(unknown.length, 'role')} no longer exist{unknown.length === 1 ? 's' : ''}.{' '}
                <Button variant="link" size="xs" className="text-[12.5px]" onClick={() => set('allowedRoleIds', form.allowedRoleIds.filter((id) => !unknown.includes(id)))}>
                  Remove
                </Button>
              </p>
            ) : null}
            {errors.allowedRoleIds ? (
              <p className="text-[13px] text-danger-700" role="alert">
                {errors.allowedRoleIds}
              </p>
            ) : null}
            <p className="text-[12.5px] text-muted">If every allowed role is deleted later, nobody can use it: never everybody.</p>
          </div>
        ) : (
          <Callout tone="neutral">
            Choosing roles needs the role:read permission.{' '}
            {form.allowedRoleIds.length ? `It allows ${pluralize(form.allowedRoleIds.length, 'role')} now; saving keeps them.` : null}
          </Callout>
        )
      ) : null}
    </Section>
  );
}

// ── Tools (Phase 5 catalogue grants) ───────────────────────────────────────

export function ToolsSection({ form, set, errors, disabled }: SectionProps) {
  return (
    <Section id="tools" title="Tools" icon={<Wrench />} description="Choose the capabilities this agent may use. Tool calls and policy refusals appear in conversations and the execution ledger.">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
        <Badge tone="outline">{form.toolIds.length ? pluralize(form.toolIds.length, 'tool') : 'No tools'}</Badge>
        <span className="text-muted">Up to {pluralize(form.maxIterations, 'tool round')} per answer.</span>
      </div>
      <ToolGrantPicker selected={form.toolIds} onChange={(ids) => set('toolIds', ids)} disabled={disabled} />
      {errors.toolIds && <p role="alert" className="text-[13px] text-danger-700">{errors.toolIds}</p>}
      <Field label="Maximum tool rounds per answer" hint="Zero disables tool use. This deployment supports up to 8 rounds." error={errors.maxIterations}>
        <Select value={String(form.maxIterations)} onValueChange={(value) => set('maxIterations', Number(value))} disabled={disabled} options={Array.from({ length: 9 }, (_, value) => ({ value: String(value), label: value === 0 ? '0 · Tool use disabled' : String(value) }))} />
      </Field>
    </Section>
  );
}
