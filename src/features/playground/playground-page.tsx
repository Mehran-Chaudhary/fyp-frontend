import { useQuery } from '@tanstack/react-query';
import { Eraser, FlaskConical, RefreshCw, ShieldAlert, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NoAccessState } from '@/components/feedback/no-access';
import { RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { llmApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { ChatCompletion, ChatMessage, ChatStreamEvent, DirectChatInput, GenerationParameters, StatusEvent } from '@/lib/api/types';
import { DIRECT_CHAT_MAX_CONTENT, DIRECT_CHAT_MAX_MESSAGES } from '@/lib/agents/limits';
import { latestSentence } from '@/lib/agents/messages';
import { postEventStream, trackStream, type StreamFailure } from '@/lib/agents/stream';
import { failureAsError, stageLabel, turnAdvice } from '@/lib/agents/turn';
import { formatMs } from '@/lib/agents/usage';
import { messageFor, titleFor } from '@/lib/errors';
import { useCountdown, useDocumentTitle } from '@/lib/hooks';
import { llmModelsQuery, llmPolicyQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { cn, formatCountdown, pluralize, timestamp } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { MaskingSummary, ModelName } from '@/features/agents/shared/agent-bits';
import { Markdown } from '@/features/agents/shared/markdown';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';
import { Composer } from '@/features/chat/composer';
import { defaultComposerSettings } from '@/features/chat/composer-settings';
import { UserBubble } from '@/features/chat/message-view';

/** One entry of the in-memory transcript. Nothing here is ever stored or persisted (§5.9). */
interface Entry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  completion?: ChatCompletion;
  stopped?: boolean;
}

interface Live {
  text: string;
  stage: StatusEvent['stage'] | null;
  model: string | null;
  masked: number | null;
  startedAt: number;
}

const DEFAULT_MODEL = '__default__';
const EXAMPLE = 'My colleague is Imran Siddiqui (imran.siddiqui@acme.test). In one sentence, tell me who to email and at which address.';

/** Direct chat (P4-API-20/21): compare models and watch masking, without an agent. */
export function PlaygroundPage() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  useDocumentTitle('Playground');
  if (!can.directChat) {
    return (
      <div className="p-6">
        <NoAccessState permissions={['llm:invoke']} workspaceName={workspace.name} title="You can't use the playground" />
      </div>
    );
  }
  return <Playground />;
}

let entryCounter = 0;
const nextId = () => `e${(entryCounter += 1)}`;

function Playground() {
  const workspace = useWorkspace();
  const models = useQuery(llmModelsQuery(workspace.id));
  const policy = useQuery(llmPolicyQuery(workspace.id));
  const [system, setSystem] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [topP, setTopP] = useState('');
  const [seed, setSeed] = useState('');
  const [stream, setStream] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [failure, setFailure] = useState<{ failure: StreamFailure; question: string; retryAt: number | null } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const waitLeft = useCountdown(failure?.retryAt ?? null);
  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries.length, live?.text.length, failure]);

  const parameters = (): GenerationParameters | string => {
    const out: GenerationParameters = {};
    const number = (raw: string, min: number, max: number, integer: boolean, label: string): number | string | undefined => {
      if (!raw.trim()) return undefined;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return `${label}: ${min} to ${max}${integer ? ', a whole number' : ''}.`;
      return value;
    };
    const t = number(temperature, 0, 2, false, 'Temperature');
    const m = number(maxOutputTokens, 1, 65_536, true, 'Max answer length');
    const p = number(topP, 0.01, 1, false, 'Top P');
    const s = number(seed, -2_147_483_648, 2_147_483_647, true, 'Seed');
    for (const value of [t, m, p, s]) if (typeof value === 'string') return value;
    if (typeof t === 'number') out.temperature = t;
    if (typeof m === 'number') out.maxOutputTokens = m;
    if (typeof p === 'number') out.topP = p;
    if (typeof s === 'number') out.seed = s;
    return out;
  };

  const run = async (question: string, history: Entry[]) => {
    const params = parameters();
    if (typeof params === 'string') {
      setFormError(params);
      setShowSettings(true);
      return;
    }
    const messages: ChatMessage[] = [
      ...(system.trim() ? [{ role: 'system' as const, content: system.trim() }] : []),
      ...history.map((entry) => ({ role: entry.role, content: entry.content })),
      { role: 'user', content: question },
    ];
    if (messages.length > DIRECT_CHAT_MAX_MESSAGES) {
      setFormError(`A request can carry at most ${DIRECT_CHAT_MAX_MESSAGES} messages. Clear the conversation to continue.`);
      return;
    }
    if (messages.some((message) => message.content.length > DIRECT_CHAT_MAX_CONTENT)) {
      setFormError(`Each message can be at most ${DIRECT_CHAT_MAX_CONTENT.toLocaleString()} characters.`);
      return;
    }
    setFormError(null);
    setFailure(null);
    const body: DirectChatInput = {
      messages,
      ...(model !== DEFAULT_MODEL ? { model } : {}),
      ...(Object.keys(params).length ? { parameters: params } : {}),
    };
    const abort = new AbortController();
    controller.current = abort;
    const untrack = trackStream(abort);
    const userEntry: Entry = { id: nextId(), role: 'user', content: question };
    setEntries([...history, userEntry]);
    let text = '';
    setLive({ text: '', stage: null, model: null, masked: null, startedAt: timestamp() });

    const finishWith = (completion: ChatCompletion | null, stopped: boolean) => {
      setEntries((current) => [...current, { id: nextId(), role: 'assistant', content: completion?.content ?? text, completion: completion ?? undefined, stopped }]);
      setLive(null);
    };
    const failWith = (failed: StreamFailure) => {
      // Nothing is stored by direct chat: drop the question from the transcript, keep it for a retry.
      setEntries(history);
      setLive(null);
      const advice = turnAdvice(failed, false);
      setFailure({ failure: failed, question, retryAt: advice.retry === 'wait' ? timestamp() + (advice.waitSeconds ?? 5) * 1000 : null });
      if (hasCode(failureAsError(failed), 'LLM_MODEL_NOT_ALLOWED', 'LLM_MODEL_NOT_FOUND')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.llm(workspace.id) });
      }
    };

    try {
      if (stream) {
        const outcome = await postEventStream<ChatStreamEvent>((options) => llmApi.chatStream(workspace.id, body, options), {
          signal: abort.signal,
          onEvent: (event) => {
            if (event.event === 'meta') setLive((current) => (current ? { ...current, model: event.data.model } : current));
            if (event.event === 'status') {
              const status = event.data;
              setLive((current) =>
                current ? { ...current, stage: status.stage, masked: status.stage === 'generating' && status.redaction ? status.redaction.entitiesMasked : current.masked } : current,
              );
            }
            if (event.event === 'delta') {
              text += event.data.text;
              const snapshot = text;
              setLive((current) => (current ? { ...current, text: snapshot } : current));
            }
          },
        });
        if (outcome.kind === 'done') finishWith(outcome.result, false);
        else if (outcome.kind === 'failed') failWith(outcome.failure);
        else if (text) finishWith(null, true);
        else {
          setEntries(history);
          setLive(null);
          if (outcome.kind === 'interrupted') setFailure({ failure: { status: 0, code: 'NETWORK_ERROR', message: 'The connection was lost before an answer arrived.', afterOpen: outcome.opened }, question, retryAt: null });
          else setDraft((current) => current || question);
        }
      } else {
        try {
          finishWith(await llmApi.chat(workspace.id, body, abort.signal), false);
        } catch (error) {
          if (abort.signal.aborted) {
            setEntries(history);
            setLive(null);
            setDraft((current) => current || question);
          } else if (isApiError(error)) {
            failWith({ status: error.status, code: error.code, message: error.message, details: error.details, retryAfterSeconds: error.retryAfterSeconds, requestId: error.requestId, afterOpen: false });
          }
        }
      }
    } finally {
      untrack();
      controller.current = null;
    }
  };

  const send = () => {
    const question = draft.trim();
    if (!question || live) return;
    setDraft('');
    void run(question, entries);
  };

  const modelOptions = [
    { value: DEFAULT_MODEL, label: 'Workspace default', description: policy.data ? `Currently ${policy.data.effective.defaultModel}` : undefined },
    ...(models.data?.models ?? [])
      .filter((item) => item.allowed)
      .map((item) => ({ value: item.name, label: <span className="font-mono text-[12.5px]">{item.name}</span>, description: item.family ?? undefined })),
  ];

  const settingsPanel = (
    <div className="grid gap-4">
      <Field label="System prompt" optional hint="Masked like everything else before it leaves.">
        <Textarea value={system} onChange={(event) => setSystem(event.target.value)} rows={5} placeholder="You are terse." className="font-mono text-[12.5px]" />
      </Field>
      <Field label="Model" hint={models.data && !models.data.verified ? "Couldn't confirm with the model server." : undefined}>
        <Select value={model} onValueChange={setModel} options={modelOptions} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Temperature" optional>
          <Input value={temperature} onChange={(event) => setTemperature(event.target.value)} inputMode="decimal" placeholder="Default" inputClassName="font-mono" />
        </Field>
        <Field label="Max answer" optional hint={policy.data ? `≤ ${policy.data.effective.maxOutputTokens.toLocaleString()}` : undefined}>
          <Input value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(event.target.value)} inputMode="numeric" placeholder="Default" inputClassName="font-mono" />
        </Field>
        <Field label="Top P" optional>
          <Input value={topP} onChange={(event) => setTopP(event.target.value)} inputMode="decimal" placeholder="Default" inputClassName="font-mono" />
        </Field>
        <Field label="Seed" optional>
          <Input value={seed} onChange={(event) => setSeed(event.target.value)} inputMode="numeric" placeholder="Random" inputClassName="font-mono" />
        </Field>
      </div>
      <label className="flex cursor-pointer items-start justify-between gap-3 text-[13px]">
        <span>
          <span className="block font-medium text-ink-soft">Stream the answer</span>
          <span className="block text-[12px] text-muted">Off: one request, the whole answer at once.</span>
        </span>
        <Switch checked={stream} onCheckedChange={setStream} />
      </label>
      <p className="text-[12px] leading-snug text-muted">
        Nothing is stored except a usage record without any content. The transcript lives on this page only and is gone when you leave.
      </p>
    </div>
  );

  const advice = failure ? turnAdvice(failure.failure, false) : null;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="scrollbar-thin hidden w-[300px] shrink-0 overflow-y-auto border-r border-line bg-[#fbfaf7] p-5 lg:block xl:w-[320px]" aria-label="Playground settings">
        <h1 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-ink">
          <FlaskConical className="size-4 text-brand-600" aria-hidden />
          Playground
        </h1>
        {settingsPanel}
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2.5 sm:px-6">
          <p className="text-[13px] text-muted">
            Direct chat with the model, no agent and no documents. {entries.length ? pluralize(entries.length, 'message') : null}
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="xs" className="lg:hidden" onClick={() => setShowSettings((value) => !value)} aria-expanded={showSettings}>
              <SlidersHorizontal />
              Settings
            </Button>
            <Button variant="ghost" size="xs" onClick={() => { setEntries([]); setFailure(null); }} disabled={!entries.length || !!live}>
              <Eraser />
              Clear
            </Button>
          </div>
        </header>
        {showSettings ? <div className="shrink-0 border-b border-line bg-[#fbfaf7] p-4 lg:hidden">{settingsPanel}</div> : null}

        <div ref={transcript} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 pt-6 pb-8 sm:px-6">
            {entries.length === 0 && !live && !failure ? (
              <div className="grid justify-items-center gap-3 py-10 text-center">
                <span className="inline-flex size-11 items-center justify-center rounded-2xl border border-line bg-surface text-ink-soft shadow-card">
                  <ShieldAlert className="size-5" aria-hidden />
                </span>
                <p className="max-w-md text-[13.5px] leading-relaxed text-muted">
                  Every message, the system prompt included, is masked before it leaves. Ask something with a name and an email address and see what the
                  masking report says.
                </p>
                <Button variant="secondary" size="sm" onClick={() => setDraft(EXAMPLE)}>
                  Try an example
                </Button>
              </div>
            ) : null}
            {entries.map((entry) =>
              entry.role === 'user' ? (
                <UserBubble key={entry.id} content={entry.content} />
              ) : (
                <article key={entry.id} className="flex flex-col gap-2">
                  <Markdown source={entry.content} />
                  {entry.stopped ? <p className="text-[12.5px] text-warning-700">Stopped: partial answer.</p> : null}
                  {entry.completion ? <Report completion={entry.completion} /> : null}
                </article>
              ),
            )}
            {live ? (
              <article className="flex flex-col gap-2" aria-busy="true">
                {live.text ? <Markdown source={live.text} streaming /> : null}
                <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                  <Spinner className="size-3.5 text-brand-600" />
                  {stageLabel(live.stage) ?? (stream ? 'Sending…' : 'Waiting for the whole answer…')}
                  {live.masked !== null ? <span className="text-faint">· {pluralize(live.masked, 'detail')} masked</span> : null}
                </p>
              </article>
            ) : null}
            {failure && advice ? (
              <div role="alert" className={cn('rounded-xl border px-4 py-3 text-[13px]', advice.retry === 'wait' ? 'border-warning-200 bg-warning-50/60 text-warning-700' : 'border-danger-200 bg-danger-50/60 text-danger-700')}>
                <p className="flex items-center gap-1.5 font-semibold">
                  <TriangleAlert className="size-3.5" aria-hidden />
                  {titleFor(failureAsError(failure.failure), "Couldn't answer")}
                </p>
                <p className="mt-0.5 text-ink-soft">{messageFor(failureAsError(failure.failure))}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Button size="xs" disabled={waitLeft > 0 || !!live} onClick={() => void run(failure.question, entries)}>
                    <RefreshCw />
                    {waitLeft > 0 ? `Try again in ${formatCountdown(waitLeft)}` : 'Try again'}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => { setDraft(failure.question); setFailure(null); }}>
                    Edit
                  </Button>
                  <RequestReference requestId={failure.failure.requestId} />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-canvas/80 px-4 pt-3 pb-4 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={send}
              onStop={() => controller.current?.abort()}
              running={!!live}
              settings={defaultComposerSettings()}
              onSettings={() => undefined}
              agent={null}
              placeholder="Message the model…"
              error={formError}
              hideSettings
            />
          </div>
        </div>
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {live?.text ? latestSentence(live.text) : ''}
        </div>
      </section>
    </div>
  );
}

/** The masking report and timings of one reply (§5.9). */
function Report({ completion }: { completion: ChatCompletion }) {
  const { redaction, timings, usage } = completion;
  return (
    <details className="group/report rounded-lg border border-line bg-well/30 text-[12.5px]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-muted [&::-webkit-details-marker]:hidden">
        <ModelName model={completion.model} className="text-[11.5px]" />
        <span>{redaction.enabled ? `${pluralize(redaction.entitiesMasked, 'detail')} masked` : 'Masking off'}</span>
        <span>{formatMs(timings.totalMs)}</span>
        <span>
          {usage.promptTokens.toLocaleString()} → {usage.completionTokens.toLocaleString()} tokens{usage.estimated ? ' (est.)' : ''}
        </span>
        <span className="ml-auto inline-flex items-center gap-2">
          <CopyButton value={completion.content} size="xs" variant="ghost" iconOnly label="Copy answer" />
          <span className="text-faint group-open/report:hidden">Details</span>
        </span>
      </summary>
      <div className="grid gap-3 border-t border-line px-3 py-3">
        <MaskingSummary
          redaction={{ enabled: redaction.enabled, degraded: redaction.degraded, entities: redaction.entitiesMasked, byType: redaction.byType }}
          extra={
            <p className="text-muted">
              {redaction.placeholdersResolved} placeholder{redaction.placeholdersResolved === 1 ? '' : 's'} put back into the answer
              {redaction.placeholdersUnresolved ? `; ${redaction.placeholdersUnresolved} the model made up were left as written` : ''}.
            </p>
          }
        />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <Timing label="Masking" value={timings.redactionMs} />
          <Timing label="Queue" value={timings.queueMs} />
          <Timing label="First token" value={timings.timeToFirstTokenMs} />
          <Timing label="Total" value={timings.totalMs} />
        </dl>
        {completion.finishReason && completion.finishReason !== 'stop' ? <p className="text-warning-700">Finished because: {completion.finishReason}</p> : null}
      </div>
    </details>
  );
}

function Timing({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono text-ink-soft tabular">{formatMs(value)}</dd>
    </div>
  );
}
