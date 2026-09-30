import { ArrowDownUp, CornerDownLeft, ListFilter, Lock, MessageSquareText, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import type { Classification, KnowledgeBase } from '@/lib/api/types';
import { readableClassifications } from '@/lib/knowledge/access';
import { SORT_PRESETS, sortPresetOf, STATUS_FILTER_LABELS, type StatusFilter, type VaultFilters } from '@/lib/knowledge/filters';
import { cn } from '@/lib/utils';
import { KnowledgeBaseDot } from '../shared/kb-identity';
import { CLASSIFICATION_META } from '../shared/meta';

export type SearchMode = 'titles' | 'ask';

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; dot: string }> = [
  { value: 'all', dot: 'bg-transparent' },
  { value: 'indexed', dot: 'bg-success-500' },
  { value: 'indexing', dot: 'bg-info-500' },
  { value: 'pending', dot: 'bg-faint' },
  { value: 'failed', dot: 'bg-danger-500' },
];

const statusLabel = (status: StatusFilter) => STATUS_FILTER_LABELS[status];

interface ToolbarProps {
  filters: VaultFilters;
  onUpdate: (patch: Partial<VaultFilters>) => void;
  knowledgeBases: readonly KnowledgeBase[];
  /** Classifications the user can read; others would always return nothing (§6.1). */
  clearance: Classification;
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  /** Ask mode needs rag:query; null hides the switch. */
  ask: null | { disabledReason: string | null; pending: boolean; onAsk: (query: string) => void };
}

/** The vault's toolbar (§6.1): search (titles, or ask), filters and sorting. */
export function VaultToolbar({ filters, onUpdate, knowledgeBases, clearance, mode, onModeChange, ask }: ToolbarProps) {
  return (
    <div className="flex flex-col gap-2.5 p-3 sm:px-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        {ask ? (
          <Segmented
            aria-label="Search mode"
            value={mode}
            onValueChange={onModeChange}
            options={[
              { value: 'titles', label: 'Titles' },
              {
                value: 'ask',
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquareText className="size-3.5" aria-hidden />
                    Ask
                  </span>
                ),
              },
            ]}
          />
        ) : null}
        {mode === 'ask' && ask ? (
          <AskBox knowledgeBaseName={knowledgeBases.find((knowledgeBase) => knowledgeBase.id === filters.kb)?.name} {...ask} />
        ) : (
          <TitleSearch value={filters.q} onChange={(q) => onUpdate({ q })} />
        )}
      </div>
      <div className="flex items-center gap-2">
        <FilterMenu filters={filters} onUpdate={onUpdate} knowledgeBases={knowledgeBases} clearance={clearance} />
        <SortMenu filters={filters} onUpdate={onUpdate} />
      </div>
    </div>
  );
}

/** Titles: filters the table as you type (debounced 300 ms; %, _ match literally). */
function TitleSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    // The URL changed from elsewhere (back button, "Clear filters").
    setSynced(value);
    setDraft(value);
  }
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const pending = timer;
    return () => window.clearTimeout(pending.current);
  }, []);

  const change = (next: string) => {
    setDraft(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(next), 300);
  };

  return (
    <Input
      className="w-full min-w-0 flex-1"
      leading={<Search />}
      value={draft}
      onChange={(event) => change(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && draft) change('');
      }}
      placeholder="Search document titles"
      aria-label="Search document titles"
      maxLength={200}
      inputClassName="h-9"
      trailing={
        draft ? (
          <Button variant="ghost" size="icon-xs" className="text-faint" onClick={() => change('')} aria-label="Clear search">
            <X />
          </Button>
        ) : null
      }
    />
  );
}

/** Ask: runs retrieval over the current knowledge-base filter (the mockup's semantic search). */
function AskBox({
  knowledgeBaseName,
  disabledReason,
  pending,
  onAsk,
}: {
  knowledgeBaseName: string | undefined;
  disabledReason: string | null;
  pending: boolean;
  onAsk: (query: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const query = draft.replace(/\s+/g, ' ').trim();
  const submit = () => {
    if (query && !pending && !disabledReason) onAsk(query);
  };

  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        className="w-full min-w-0 flex-1"
        leading={<MessageSquareText />}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={
          disabledReason ?? (knowledgeBaseName ? `Ask a question about ${knowledgeBaseName}…` : 'Ask a question across your knowledge bases…')
        }
        aria-label="Ask a question"
        maxLength={2000}
        disabled={!!disabledReason}
        inputClassName="h-9"
        trailing={
          query && !pending ? (
            <span className="pointer-events-none mr-1.5 hidden sm:inline-flex">
              <Kbd>
                <CornerDownLeft className="size-3" />
              </Kbd>
            </span>
          ) : null
        }
      />
      <Button type="submit" size="sm" className="h-9" disabled={!query || !!disabledReason} loading={pending}>
        {pending ? null : <Search />}
        Ask
      </Button>
    </form>
  );
}

function FilterMenu({
  filters,
  onUpdate,
  knowledgeBases,
  clearance,
}: {
  filters: VaultFilters;
  onUpdate: (patch: Partial<VaultFilters>) => void;
  knowledgeBases: readonly KnowledgeBase[];
  clearance: Classification;
}) {
  const active = (filters.kb ? 1 : 0) + (filters.status !== 'all' ? 1 : 0) + (filters.classification ? 1 : 0);
  const currentKb = knowledgeBases.find((knowledgeBase) => knowledgeBase.id === filters.kb);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="h-9 data-[state=open]:bg-well">
          <ListFilter />
          Filter
          {active ? (
            <span className="rounded bg-brand-600 px-1.5 text-[11px] leading-[18px] font-semibold text-white tabular">{active}</span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>Filter documents</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger hint={currentKb?.name ?? 'All'}>Knowledge base</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuCheckItem checked={!filters.kb} onSelect={() => onUpdate({ kb: null })}>
              All knowledge bases
            </DropdownMenuCheckItem>
            {knowledgeBases.length ? <DropdownMenuSeparator /> : null}
            {knowledgeBases.map((knowledgeBase) => (
              <DropdownMenuCheckItem
                key={knowledgeBase.id}
                checked={filters.kb === knowledgeBase.id}
                onSelect={() => onUpdate({ kb: knowledgeBase.id })}
              >
                <KnowledgeBaseDot id={knowledgeBase.id} />
                <span className="min-w-0 flex-1 truncate">{knowledgeBase.name}</span>
                {knowledgeBase.accessMode === 'RESTRICTED' ? <Lock className="!size-3" aria-label="Restricted" /> : null}
                <span className="text-xs text-faint tabular">{knowledgeBase.stats.documents}</span>
              </DropdownMenuCheckItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger hint={filters.status === 'all' ? 'Any' : statusLabel(filters.status)}>Status</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {STATUS_OPTIONS.map((option) => (
              <DropdownMenuCheckItem key={option.value} checked={filters.status === option.value} onSelect={() => onUpdate({ status: option.value })}>
                <span className={cn('size-2 rounded-full', option.dot)} aria-hidden />
                {statusLabel(option.value)}
              </DropdownMenuCheckItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger hint={filters.classification ? CLASSIFICATION_META[filters.classification].label : 'Any'}>
            Classification
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuCheckItem checked={!filters.classification} onSelect={() => onUpdate({ classification: null })}>
              Any classification
            </DropdownMenuCheckItem>
            <DropdownMenuSeparator />
            {/* Only those within your clearance: the others would always return nothing. */}
            {readableClassifications(clearance).map((classification) => (
              <DropdownMenuCheckItem
                key={classification}
                checked={filters.classification === classification}
                onSelect={() => onUpdate({ classification })}
              >
                {CLASSIFICATION_META[classification].label}
              </DropdownMenuCheckItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {active ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckItem onSelect={() => onUpdate({ kb: null, status: 'all', classification: null })}>
              <X />
              Clear filters
            </DropdownMenuCheckItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortMenu({ filters, onUpdate }: { filters: VaultFilters; onUpdate: (patch: Partial<VaultFilters>) => void }) {
  const current = sortPresetOf(filters);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="h-9 data-[state=open]:bg-well">
          <ArrowDownUp />
          <span className="hidden sm:inline">{current?.label ?? 'Sort'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        {SORT_PRESETS.map((preset) => (
          <DropdownMenuCheckItem
            key={preset.key}
            checked={current?.key === preset.key}
            onSelect={() => onUpdate({ sort: preset.sort, dir: preset.dir })}
          >
            {preset.label}
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The active filters as removable chips, under the toolbar. */
export function ActiveFilters({
  filters,
  onUpdate,
  knowledgeBaseName,
}: {
  filters: VaultFilters;
  onUpdate: (patch: Partial<VaultFilters>) => void;
  knowledgeBaseName: string | null;
}) {
  const chips: Array<{ key: string; label: ReactNode; clear: Partial<VaultFilters> }> = [];
  if (filters.kb) {
    chips.push({
      key: 'kb',
      label: (
        <>
          <KnowledgeBaseDot id={filters.kb} />
          {knowledgeBaseName ?? 'Knowledge base'}
        </>
      ),
      clear: { kb: null },
    });
  }
  if (filters.status !== 'all') chips.push({ key: 'status', label: `Status: ${statusLabel(filters.status)}`, clear: { status: 'all' } });
  if (filters.classification) {
    chips.push({
      key: 'classification',
      label: `Classification: ${CLASSIFICATION_META[filters.classification].label}`,
      clear: { classification: null },
    });
  }
  if (filters.q.trim()) chips.push({ key: 'q', label: `Title contains “${filters.q.trim()}”`, clear: { q: '' } });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2 sm:px-4">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-well/70 py-0.5 pr-0.5 pl-2 text-[12px] text-ink-soft"
        >
          <span className="flex min-w-0 items-center gap-1.5 truncate">{chip.label}</span>
          <Tooltip content="Remove filter">
            <button
              type="button"
              onClick={() => onUpdate(chip.clear)}
              className="inline-flex size-5 items-center justify-center rounded text-faint hover:bg-well-strong hover:text-ink"
              aria-label="Remove filter"
            >
              <X className="size-3" />
            </button>
          </Tooltip>
        </span>
      ))}
      {chips.length > 1 ? (
        <Button variant="link" size="xs" className="ml-1 text-xs" onClick={() => onUpdate({ kb: null, status: 'all', classification: null, q: '' })}>
          Clear all
        </Button>
      ) : null}
    </div>
  );
}
