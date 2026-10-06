import { ArrowUp, Settings2, Square } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { CheckboxBox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/ui/tooltip';
import type { Agent } from '@/lib/api/types';
import { AGENT_MAX_MESSAGE_LENGTH } from '@/lib/agents/limits';
import { cn } from '@/lib/utils';
import { KnowledgeBaseName } from '@/features/knowledge/shared/kb-identity';
import { useKnowledgeBases } from '@/features/knowledge/shared/use-knowledge-access';
import { defaultComposerSettings, type ComposerSettings } from './composer-settings';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** A turn is streaming: the box stays editable, sending waits, Stop shows. */
  running: boolean;
  /** Something else holds the conversation (reading back a stopped turn): sending waits, no Stop. */
  busy?: boolean;
  /** Why the composer can't send at all (archived, agent gone…); replaces the input's hint. */
  blocked?: ReactNode;
  settings: ComposerSettings;
  onSettings: (settings: ComposerSettings) => void;
  agent: Agent | null;
  placeholder?: string;
  autoFocus?: boolean;
  /** An error about the settings, shown above the box. */
  error?: string | null;
  /** No per-turn options (the playground has its own settings panel). */
  hideSettings?: boolean;
}

/**
 * The question box (§5.6 "Composer"): Enter sends, Shift+Enter starts a new line,
 * and nothing is sent while another turn runs. The counter appears near the
 * deployment's message cap (16,000 characters).
 */
export function Composer({ value, onChange, onSend, onStop, running, busy = false, blocked, settings, onSettings, agent, placeholder, autoFocus, error, hideSettings }: ComposerProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const length = value.length;
  const over = length > AGENT_MAX_MESSAGE_LENGTH;
  const nearLimit = length > AGENT_MAX_MESSAGE_LENGTH * 0.8;
  const canSend = !running && !busy && !blocked && value.trim().length > 0 && !over;

  // Grow with the text, up to a limit; then scroll inside.
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 260)}px`;
  }, [value]);

  return (
    <div className="grid gap-2">
      {error ? (
        <p className="text-[12.5px] text-danger-700" role="alert">
          {error}
        </p>
      ) : null}
      <div
        className={cn(
          'rounded-2xl border bg-surface shadow-[0_1px_2px_rgb(28_27_24/0.05),0_8px_24px_-16px_rgb(28_27_24/0.25)] transition-[border-color,box-shadow]',
          'focus-within:border-brand-400 focus-within:shadow-[0_0_0_3px_rgb(54_132_106/0.14)]',
          blocked ? 'border-line bg-well/40' : 'border-line-strong',
        )}
      >
        <label htmlFor="composer" className="sr-only">
          Your question
        </label>
        <textarea
          id="composer"
          ref={area}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          rows={1}
          disabled={!!blocked}
          autoFocus={autoFocus}
          placeholder={blocked ? '' : (placeholder ?? 'Ask a question…')}
          aria-describedby="composer-hint"
          className="scrollbar-thin block max-h-[260px] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed text-ink placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
          {hideSettings ? <span /> : <TurnSettings settings={settings} onSettings={onSettings} agent={agent} disabled={!!blocked} />}
          <div className="flex items-center gap-2">
            {nearLimit ? (
              <span className={cn('text-xs tabular', over ? 'font-medium text-danger-700' : 'text-faint')}>
                {length.toLocaleString()}/{AGENT_MAX_MESSAGE_LENGTH.toLocaleString()}
              </span>
            ) : null}
            {running ? (
              <Tooltip content="Stop the answer. What was written so far is kept.">
                <Button variant="secondary" size="icon-sm" className="rounded-full" onClick={onStop} aria-label="Stop answering">
                  <Square className="fill-current" />
                </Button>
              </Tooltip>
            ) : busy ? (
              <Button size="icon-sm" className="rounded-full" disabled aria-label="Waiting for the previous answer">
                <Spinner />
              </Button>
            ) : (
              <Button size="icon-sm" className="rounded-full" onClick={onSend} disabled={!canSend} aria-label="Send">
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
      <p id="composer-hint" className="px-1 text-[11.5px] text-faint">
        {blocked ?? (
          <>
            <span className="hidden sm:inline">Enter to send, Shift+Enter for a new line. </span>
            Personal data is masked before the model sees it.
          </>
        )}
      </p>
    </div>
  );
}

function TurnSettings({ settings, onSettings, agent, disabled }: { settings: ComposerSettings; onSettings: (settings: ComposerSettings) => void; agent: Agent | null; disabled: boolean }) {
  const knowledgeBases = useKnowledgeBases();
  const set = <K extends keyof ComposerSettings>(key: K, value: ComposerSettings[K]) => onSettings({ ...settings, [key]: value });
  const agentBases = agent?.config.retrieval.knowledgeBaseIds ?? [];
  const retrieves = !!agent?.config.retrieval.enabled && (agentBases.length > 0 || (agent?.config.retrieval.hiddenKnowledgeBases ?? 0) > 0);
  const changed = !settings.stream || settings.retrievalOff || settings.narrowTo.length > 0 || !!settings.temperature || !!settings.maxOutputTokens;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" disabled={disabled} className={cn('text-muted', changed && 'text-brand-700')}>
          <Settings2 />
          {changed ? 'Custom' : 'Options'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]" side="top" align="start">
        <div className="grid gap-3.5 text-[13px]">
          <p className="text-[12px] text-muted">For the next questions in this conversation only.</p>
          <Toggle label="Stream the answer" description="Show words as they're written. Off: wait for the whole answer." checked={settings.stream} onChange={(value) => set('stream', value)} />
          {retrieves ? (
            <>
              <Toggle
                label="Search knowledge"
                description="Off: answer without retrieving any document."
                checked={!settings.retrievalOff}
                onChange={(value) => set('retrievalOff', !value)}
              />
              {!settings.retrievalOff && agentBases.length > 1 ? (
                <div className="grid gap-1.5">
                  <p className="font-medium text-ink-soft">Only search</p>
                  <ul className="grid gap-1">
                    {agentBases.map((id) => {
                      const knowledgeBase = knowledgeBases.byId.get(id);
                      const on = settings.narrowTo.includes(id);
                      return (
                        <li key={id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-well/60">
                            <CheckboxBox
                              className="mt-0"
                              checked={on}
                              onCheckedChange={(checked) => set('narrowTo', checked ? [...settings.narrowTo, id] : settings.narrowTo.filter((item) => item !== id))}
                            />
                            {knowledgeBase ? <KnowledgeBaseName knowledgeBase={knowledgeBase} className="text-ink-soft" /> : <span className="text-muted">Knowledge base</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[11.5px] text-muted">None ticked: every base it uses that you can read.</p>
                </div>
              ) : null}
            </>
          ) : null}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="grid gap-1">
              <span className="font-medium text-ink-soft">Temperature</span>
              <Input value={settings.temperature} onChange={(event) => set('temperature', event.target.value)} inputMode="decimal" placeholder="Agent's" inputClassName="h-8 font-mono text-[12.5px]" />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-ink-soft">Max answer</span>
              <Input value={settings.maxOutputTokens} onChange={(event) => set('maxOutputTokens', event.target.value)} inputMode="numeric" placeholder="Agent's" inputClassName="h-8 font-mono text-[12.5px]" />
            </label>
          </div>
          {changed ? (
            <Button variant="ghost" size="xs" className="w-fit" onClick={() => onSettings(defaultComposerSettings())}>
              Reset to the agent's settings
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block font-medium text-ink-soft">{label}</span>
        <span className="block text-[12px] text-muted">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
