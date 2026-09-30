import { Check, Pipette } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { isHexColor, normaliseHex, ROLE_COLOR_PRESETS } from '@/lib/color';
import { cn } from '@/lib/utils';

/** Preset swatches, a picker for anything else, and the hex value (spec §5.6). */
export function ColorField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const current = isHexColor(value) ? normaliseHex(value) : value;
  const isPreset = ROLE_COLOR_PRESETS.some((preset) => preset === current);

  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Preset colours" className="flex flex-wrap items-center gap-2">
        {ROLE_COLOR_PRESETS.map((preset) => {
          const selected = current === preset;
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset}
              disabled={disabled}
              onClick={() => onChange(preset)}
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-full border border-black/10 transition-transform',
                'hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:pointer-events-none disabled:opacity-50',
                selected && 'ring-2 ring-ink/70 ring-offset-2 ring-offset-surface',
              )}
              style={{ backgroundColor: preset }}
            >
              {selected ? <Check className="size-3.5 text-white" strokeWidth={3} /> : null}
            </button>
          );
        })}
        <Tooltip content="Pick any colour">
          <label
            className={cn(
              'relative inline-flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-line-strong bg-surface text-muted hover:text-ink',
              !isPreset && isHexColor(current) && 'border-solid ring-2 ring-ink/70 ring-offset-2 ring-offset-surface',
              disabled && 'pointer-events-none opacity-50',
            )}
            style={!isPreset && isHexColor(current) ? { backgroundColor: current } : undefined}
          >
            <Pipette className={cn('size-3.5', !isPreset && isHexColor(current) && 'text-white mix-blend-difference')} />
            <input
              type="color"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={isHexColor(current) ? normaliseHex(current) : '#206c55'}
              onChange={(event) => onChange(event.target.value)}
              disabled={disabled}
              aria-label="Custom colour"
            />
          </label>
        </Tooltip>
      </div>
      {/* The hex value; labelled by the enclosing <Field>. */}
      <Input
        className="w-36"
        inputClassName="font-mono uppercase"
        value={draft ?? current}
        maxLength={7}
        disabled={disabled}
        spellCheck={false}
        leading={
          <span
            className="inline-block size-3.5 rounded-full border border-black/10"
            style={{ backgroundColor: isHexColor(draft ?? current) ? (draft ?? current) : 'transparent' }}
          />
        }
        onChange={(event) => {
          let next = event.target.value.trim();
          if (next && !next.startsWith('#')) next = `#${next}`;
          setDraft(next);
          if (isHexColor(next)) onChange(normaliseHex(next));
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}
