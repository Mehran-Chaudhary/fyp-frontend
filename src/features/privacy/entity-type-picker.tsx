import { Lock, Plus, ScanText, Sparkles, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxBox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { PiiDetector, PiiEntityType } from '@/lib/api/types';
import { humanizeEntityType } from '@/lib/knowledge/pii';
import { CUSTOM_ENTITY_TYPE, ENTITY_TYPE_PATTERN, toEntityTypeName } from '@/lib/knowledge/pii-policy';
import { cn, pluralize } from '@/lib/utils';
import { entityTone } from '@/features/knowledge/shared/pii-colors';
import { DETECTOR_GROUPS, DETECTOR_ORDER } from './privacy-copy';

/**
 * The entity catalogue (P3-API-19) as the policy's "what to mask" control, grouped by
 * detector with each type's availability on this deployment. The policy may also name
 * Presidio types that aren't in the catalogue: they're listed under "Other types" and
 * can be added by name. CUSTOM is never chosen here: the server adds it exactly while
 * the deny list has terms.
 */
export function EntityTypePicker({
  value,
  onChange,
  catalogue,
  nerEntityTypes,
  denyListCount,
  readOnly,
  error,
}: {
  /** Upper-case, without CUSTOM. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  catalogue: readonly PiiEntityType[];
  /** The policy's types that need the NER detector, including ones outside the catalogue. */
  nerEntityTypes: readonly string[];
  /** Terms on the deny list (the draft's, or the server's count for readers). */
  denyListCount: number;
  readOnly: boolean;
  error?: string;
}) {
  const selected = new Set(value);
  const known = new Set(catalogue.map((type) => type.type));
  const others = value.filter((type) => !known.has(type));
  const toggle = (type: string, on: boolean) => onChange(on ? [...value, type] : value.filter((candidate) => candidate !== type));
  const choosable = catalogue.filter((type) => type.detector !== 'custom');

  return (
    <div className="grid grid-cols-1 gap-5">
      <p className="text-[13px] text-muted" aria-live="polite">
        {pluralize(value.length, 'type')} masked
        {choosable.length ? ` of the ${choosable.length} in the catalogue` : ''}
        {others.length ? `, plus ${pluralize(others.length, 'other type')}` : ''}.
      </p>

      {DETECTOR_ORDER.map((detector) => {
        const types = catalogue.filter((type) => type.detector === detector);
        if (types.length === 0) return null;
        return (
          <Group
            key={detector}
            detector={detector}
            types={types}
            selected={selected}
            onToggle={toggle}
            onAll={(on) => {
              const ids = types.filter((type) => type.detector !== 'custom').map((type) => type.type);
              onChange(on ? Array.from(new Set([...value, ...ids])) : value.filter((type) => !ids.includes(type)));
            }}
            denyListCount={denyListCount}
            readOnly={readOnly}
          />
        );
      })}

      <OtherTypes
        types={others}
        nerEntityTypes={nerEntityTypes}
        readOnly={readOnly}
        onRemove={(type) => toggle(type, false)}
        onAdd={(type) => onChange(Array.from(new Set([...value, type])))}
        known={known}
      />
      {error ? (
        <p className="text-[13px] text-danger-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Group({
  detector,
  types,
  selected,
  onToggle,
  onAll,
  denyListCount,
  readOnly,
}: {
  detector: PiiDetector;
  types: readonly PiiEntityType[];
  selected: ReadonlySet<string>;
  onToggle: (type: string, on: boolean) => void;
  onAll: (on: boolean) => void;
  denyListCount: number;
  readOnly: boolean;
}) {
  const headingId = useId();
  const meta = DETECTOR_GROUPS[detector];
  const choosable = types.filter((type) => type.detector !== 'custom');
  const chosen = choosable.filter((type) => selected.has(type.type)).length;
  const unavailable = types.filter((type) => !type.available).length;

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-line">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-well/40 px-3.5 py-2.5">
        <div className="min-w-0">
          <h4 id={headingId} className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            {detector === 'ner' ? <Sparkles className="size-3.5 text-faint" aria-hidden /> : detector === 'custom' ? <Lock className="size-3.5 text-faint" aria-hidden /> : <ScanText className="size-3.5 text-faint" aria-hidden />}
            {meta.title}
            {choosable.length ? <span className="font-normal text-muted tabular">{chosen}/{choosable.length}</span> : null}
          </h4>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{meta.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {unavailable ? (
            <Badge tone="warning">{unavailable === types.length ? 'Unavailable here' : `${unavailable} unavailable`}</Badge>
          ) : (
            <Badge tone="success" dot>
              Available
            </Badge>
          )}
          {!readOnly && choosable.length > 1 ? (
            <Button variant="ghost" size="xs" onClick={() => onAll(chosen < choosable.length)}>
              {chosen < choosable.length ? 'Select all' : 'Clear'}
            </Button>
          ) : null}
        </div>
      </header>
      <ul className="divide-y divide-line/70">
        {types.map((type) => (
          <TypeRow
            key={type.type}
            type={type}
            checked={type.detector === 'custom' ? denyListCount > 0 : selected.has(type.type)}
            locked={type.detector === 'custom'}
            denyListCount={denyListCount}
            readOnly={readOnly}
            onToggle={(on) => onToggle(type.type, on)}
          />
        ))}
      </ul>
    </section>
  );
}

function TypeRow({
  type,
  checked,
  locked,
  denyListCount,
  readOnly,
  onToggle,
}: {
  type: PiiEntityType;
  checked: boolean;
  /** CUSTOM: follows the deny list, never toggled directly. */
  locked: boolean;
  denyListCount: number;
  readOnly: boolean;
  onToggle: (on: boolean) => void;
}) {
  const id = useId();
  const tone = entityTone(type.type);
  return (
    <li className={cn('flex items-start gap-3 px-3.5 py-2.5', !type.available && 'bg-warning-50/30')}>
      <CheckboxBox
        id={id}
        checked={checked}
        onCheckedChange={onToggle}
        disabled={readOnly || locked}
        className="mt-0.5"
      />
      <label htmlFor={id} className={cn('min-w-0 flex-1', readOnly || locked ? 'cursor-default' : 'cursor-pointer')}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium text-ink">{type.label}</span>
          <span className={cn('inline-flex items-center gap-1 rounded border px-1 font-mono text-[10.5px] leading-4', tone.chip)}>
            <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden />
            {type.type}
          </span>
          {!type.available ? <Badge tone="warning">Not detectable here</Badge> : null}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
          {locked
            ? denyListCount > 0
              ? `On while the deny list has terms (${denyListCount}).`
              : 'Off: the deny list is empty.'
            : type.description}
        </span>
        {type.example && !locked ? (
          <span className="mt-0.5 block truncate text-[11.5px] text-faint">
            e.g. <span className="font-mono">{type.example}</span>
          </span>
        ) : null}
      </label>
    </li>
  );
}

function OtherTypes({
  types,
  nerEntityTypes,
  readOnly,
  onRemove,
  onAdd,
  known,
}: {
  types: readonly string[];
  nerEntityTypes: readonly string[];
  readOnly: boolean;
  onRemove: (type: string) => void;
  onAdd: (type: string) => void;
  known: ReadonlySet<string>;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();

  if (readOnly && types.length === 0) return null;

  const add = () => {
    const name = toEntityTypeName(draft);
    if (!name) return;
    if (name === CUSTOM_ENTITY_TYPE) return setProblem('Custom follows the deny list: add terms there instead.');
    if (!ENTITY_TYPE_PATTERN.test(name)) return setProblem('Use letters, digits and _ (2–41 characters), starting with a letter.');
    if (known.has(name)) return setProblem('That type is in the catalogue above: tick it there.');
    onAdd(name);
    setDraft('');
    setProblem(null);
  };

  return (
    <section className="rounded-lg border border-dashed border-line-strong px-3.5 py-3">
      <h4 className="text-[13px] font-semibold text-ink">Other types</h4>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        Any Presidio entity name is accepted, such as <span className="font-mono">UK_NHS</span> or{' '}
        <span className="font-mono">MEDICAL_LICENSE</span>. It's only masked if a detector on this deployment recognises it.
      </p>
      {types.length ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {types.map((type) => (
            <li key={type}>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-well py-0.5 pr-0.5 pl-2 text-[12px] text-ink-soft">
                <span className="font-mono text-[11.5px]">{type}</span>
                <span className="text-faint">{humanizeEntityType(type)}</span>
                {nerEntityTypes.includes(type) ? <Badge tone="outline">NER</Badge> : null}
                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => onRemove(type)}
                    className="inline-flex size-5 items-center justify-center rounded text-faint hover:bg-well-strong hover:text-ink"
                    aria-label={`Stop masking ${type}`}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {readOnly ? null : (
        <div className="mt-2.5 flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Input
              id={inputId}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                }
              }}
              placeholder="ENTITY_NAME"
              aria-label="Add an entity type by name"
              maxLength={41}
              className="w-full max-w-60"
              inputClassName="h-8 font-mono text-[12.5px] uppercase"
            />
            <Button size="sm" variant="secondary" onClick={add} disabled={!draft.trim()}>
              <Plus />
              Add
            </Button>
          </div>
          {problem ? (
            <p className="text-xs text-danger-700" role="alert">
              {problem}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
