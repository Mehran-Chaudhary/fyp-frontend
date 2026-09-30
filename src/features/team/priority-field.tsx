import { Slider } from 'radix-ui';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import type { Role } from '@/lib/api/types';
import { cn } from '@/lib/utils';

const THUMB = 18; // px, keep in sync with the thumb's size-[18px]

/** Where Radix centres the thumb for a value, so markers line up with it. */
const position = (value: number) => `calc(${value}% + ${(0.5 - value / 100) * THUMB}px)`;

/**
 * A role's priority on the 0–100 scale (spec §5.6). The range above your own
 * rank is hatched: you can't create or raise a role to your level. Built-in roles
 * and your rank are marked for orientation.
 */
export function PriorityField({
  value,
  onChange,
  max,
  myPriority,
  roles,
  currentRoleId,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  /** The highest value allowed: min(99, your rank − 1). */
  max: number;
  myPriority: number;
  roles: readonly Role[];
  currentRoleId?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (next: number) => Math.max(0, Math.min(max, Math.round(next)));
  const others = roles.filter((role) => role.id !== currentRoleId);
  const builtIns = others.filter((role) => role.isSystem);
  const customs = others.filter((role) => !role.isSystem);
  const youMatchesBuiltIn = builtIns.some((role) => role.priority === myPriority);

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-4">
        <div className="relative min-w-0 flex-1 pt-1 pb-7">
          <Slider.Root
            min={0}
            max={100}
            step={1}
            value={[value]}
            disabled={disabled}
            onValueChange={([next]) => onChange(clamp(next))}
            className="relative flex h-5 w-full touch-none items-center select-none data-[disabled]:opacity-60"
          >
            <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-well-strong">
              {max < 100 ? (
                <span
                  aria-hidden
                  className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,var(--color-line-strong)_0_2px,transparent_2px_5px)]"
                  style={{ left: `${max + 1}%` }}
                />
              ) : null}
              <Slider.Range className="absolute h-full rounded-full bg-brand-500" />
            </Slider.Track>
            <Slider.Thumb
              aria-label="Priority"
              className="block size-[18px] cursor-grab rounded-full border-2 border-brand-600 bg-white shadow-[0_1px_3px_rgb(28_27_24/0.25)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 active:cursor-grabbing data-[disabled]:cursor-not-allowed"
            />
          </Slider.Root>

          {/* Custom roles: small ticks on the track. */}
          {customs.map((role) => (
            <Tooltip key={role.id} content={`${role.name} · ${role.priority}`}>
              <span
                aria-hidden
                className="absolute top-[9px] h-2.5 w-px -translate-x-1/2 bg-ink-soft/40"
                style={{ left: position(role.priority) }}
              />
            </Tooltip>
          ))}

          {/* Built-in roles and you: labelled under the track. */}
          {builtIns.map((role) => (
            <Marker
              key={role.id}
              at={role.priority}
              label={role.priority === myPriority ? `${role.name} · you` : role.name}
              emphasis={role.priority === myPriority}
            />
          ))}
          {youMatchesBuiltIn ? null : <Marker at={myPriority} label="You" emphasis />}
        </div>
        {/* Picks up its label and description from the enclosing <Field>. */}
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          disabled={disabled}
          className="w-20 shrink-0"
          inputClassName="text-center font-mono tabular"
          value={draft ?? String(value)}
          onChange={(event) => {
            setDraft(event.target.value);
            const parsed = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(parsed)) onChange(clamp(parsed));
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
    </div>
  );
}

function Marker({ at, label, emphasis }: { at: number; label: string; emphasis?: boolean }) {
  const align = at <= 6 ? 'translate-x-0' : at >= 94 ? '-translate-x-full' : '-translate-x-1/2';
  return (
    <span className="pointer-events-none absolute top-[26px]" style={{ left: position(at) }} aria-hidden>
      <span
        className={cn(
          'absolute -top-[14px] left-0 h-2 w-px -translate-x-1/2',
          emphasis ? 'bg-brand-600' : 'bg-line-strong',
        )}
      />
      <span
        className={cn(
          'absolute top-0 left-0 text-[11px] whitespace-nowrap',
          align,
          emphasis ? 'font-medium text-brand-700' : 'text-faint',
        )}
      >
        {label}
        <span className="ml-1 font-mono tabular">{at}</span>
      </span>
    </span>
  );
}
