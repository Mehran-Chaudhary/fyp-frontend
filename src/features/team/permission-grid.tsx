import { Info, Lock, Search, TriangleAlert, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxBox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/ui/tooltip';
import type { PermissionDefinition } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { groupPermissions } from './permission-categories';

interface PermissionGridProps {
  permissions: readonly PermissionDefinition[];
  selected: ReadonlySet<string>;
  /** Omit for a read-only grid. */
  onChange?: (next: Set<string>) => void;
  /** Keys you hold; only these can be granted (spec §5.6). */
  grantable: ReadonlySet<string>;
  className?: string;
}

/**
 * The permission catalogue as a checklist, one section per category. Rows for
 * permissions you don't hold are disabled: you can only grant what you have.
 */
export function PermissionGrid({ permissions, selected, onChange, grantable, className }: PermissionGridProps) {
  const [filter, setFilter] = useState('');
  const [onlySelected, setOnlySelected] = useState(!onChange);
  const onlySelectedId = useId();
  const readOnly = !onChange;
  const needle = filter.trim().toLowerCase();

  const groups = groupPermissions(permissions)
    .map((group) => ({
      ...group,
      visible: group.permissions.filter(
        (permission) =>
          (!onlySelected || selected.has(permission.key)) &&
          (!needle ||
            permission.key.includes(needle) ||
            permission.description.toLowerCase().includes(needle)),
      ),
    }))
    .filter((group) => group.visible.length > 0);

  const toggle = (key: string, next: boolean) => {
    if (!onChange) return;
    const updated = new Set(selected);
    if (next) updated.add(key);
    else updated.delete(key);
    onChange(updated);
  };

  const toggleGroup = (keys: string[], next: boolean) => {
    if (!onChange) return;
    const updated = new Set(selected);
    for (const key of keys) {
      if (next) updated.add(key);
      else updated.delete(key);
    }
    onChange(updated);
  };

  const sensitiveSelected = permissions.filter((permission) => permission.isDangerous && selected.has(permission.key)).length;

  return (
    <div className={cn('grid gap-3', className)}>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <Input
          className="w-full sm:w-64"
          inputClassName="h-9"
          leading={<Search />}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter permissions"
          aria-label="Filter permissions"
          trailing={
            filter ? (
              <Button variant="ghost" size="icon-xs" className="text-faint" onClick={() => setFilter('')} aria-label="Clear filter">
                <X />
              </Button>
            ) : null
          }
        />
        <div className="flex items-center gap-2">
          <Switch id={onlySelectedId} checked={onlySelected} onCheckedChange={setOnlySelected} />
          <label htmlFor={onlySelectedId} className="cursor-pointer text-[13px] text-ink-soft select-none">
            Only selected
          </label>
        </div>
        <p className="text-xs text-muted sm:ml-auto tabular" aria-live="polite">
          <span className="font-medium text-ink-soft">{selected.size}</span> of {permissions.length} selected
          {sensitiveSelected > 0 ? <> · {sensitiveSelected} sensitive</> : null}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-line">
        {groups.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">
            {onlySelected && selected.size === 0 ? 'No permissions selected yet.' : 'No permissions match this filter.'}
          </p>
        ) : (
          groups.map((group, index) => {
            const inGroup = group.permissions.filter((permission) => selected.has(permission.key)).length;
            const enabledKeys = group.visible.map((permission) => permission.key).filter((key) => grantable.has(key));
            const enabledSelected = enabledKeys.filter((key) => selected.has(key)).length;
            const headerState =
              enabledSelected === 0 ? false : enabledSelected === enabledKeys.length ? true : ('indeterminate' as const);
            return (
              <section key={group.key} className={cn(index > 0 && 'border-t border-line')}>
                <header className="flex items-center gap-3 bg-well/55 px-4 py-2">
                  {!readOnly && enabledKeys.length > 0 ? (
                    <CheckboxBox
                      checked={headerState}
                      onCheckedChange={() => toggleGroup(enabledKeys, headerState !== true)}
                      aria-label={`Select every permission you can grant in ${group.label}`}
                      className="mt-0"
                    />
                  ) : null}
                  <h3 className="text-[13px] font-semibold text-ink">{group.label}</h3>
                  <span className="text-xs text-muted tabular">
                    {inGroup}/{group.permissions.length}
                  </span>
                </header>
                <ul className="divide-y divide-line/60">
                  {group.visible.map((permission) => (
                    <PermissionRow
                      key={permission.key}
                      permission={permission}
                      checked={selected.has(permission.key)}
                      held={grantable.has(permission.key)}
                      readOnly={readOnly}
                      onToggle={(next) => toggle(permission.key, next)}
                    />
                  ))}
                </ul>
                {group.key === 'clearance' ? (
                  <p className="flex items-start gap-2 border-t border-line/60 bg-info-50/50 px-4 py-2.5 text-xs leading-relaxed text-info-700">
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>
                      Reading documents: Restricted includes Confidential and Internal. When granting, the three are
                      independent: to grant <code className="font-mono">clearance:internal</code> you must hold{' '}
                      <code className="font-mono">clearance:internal</code> itself.
                    </span>
                  </p>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function PermissionRow({
  permission,
  checked,
  held,
  readOnly,
  onToggle,
}: {
  permission: PermissionDefinition;
  checked: boolean;
  held: boolean;
  readOnly: boolean;
  onToggle: (next: boolean) => void;
}) {
  const id = useId();
  const disabled = readOnly || !held;
  return (
    <li className={cn('flex items-start gap-3 px-4 py-2.5', checked && !readOnly && 'bg-brand-50/30')}>
      <CheckboxBox id={id} checked={checked} disabled={disabled} onCheckedChange={onToggle} />
      <label htmlFor={id} className={cn('min-w-0 flex-1', disabled ? 'cursor-default' : 'cursor-pointer')}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <code className={cn('font-mono text-[12px]', !held && !readOnly ? 'text-muted' : 'text-ink')}>{permission.key}</code>
          {permission.isDangerous ? (
            <Badge tone="warning">
              <TriangleAlert />
              Sensitive
            </Badge>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted">{permission.description}</span>
      </label>
      {!held && !readOnly ? (
        <Tooltip content="You don't hold this permission, so you can't grant it." side="left">
          <span tabIndex={0} className="mt-0.5 rounded-sm text-faint" aria-label="You don't hold this permission">
            <Lock className="size-3.5" />
          </span>
        </Tooltip>
      ) : null}
    </li>
  );
}
