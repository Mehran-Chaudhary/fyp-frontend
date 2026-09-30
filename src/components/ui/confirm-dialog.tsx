import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertDialog, AlertDialogContent, AlertDialogHeader } from './dialog';
import { Button } from './button';
import { Field, FormError } from './field';
import { Input } from './input';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'danger' | 'warning';
  confirmLabel: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
  /** The action is in flight: buttons disabled, dialog can't be dismissed. */
  pending?: boolean;
  /** Extra reasons to hold the confirm button (e.g. an invalid reason field). */
  confirmDisabled?: boolean;
  /** Extra content between the header and the buttons (reason fields, notes). */
  children?: ReactNode;
  /** When set, the exact text the user must type before confirming. */
  typeToConfirm?: string;
  /** Label above the type-to-confirm field; defaults to "Type {value} to confirm". */
  typeToConfirmLabel?: ReactNode;
  /** A refusal to show inside the dialog. */
  error?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * The confirmation used before every destructive or security-sensitive action
 * (spec §5 conventions). It stays open while the request runs and shows the
 * server's refusal in place, so the user never loses context.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  tone = 'neutral',
  confirmLabel,
  confirmVariant = tone === 'danger' ? 'danger' : 'primary',
  onConfirm,
  pending,
  confirmDisabled,
  children,
  typeToConfirm,
  typeToConfirmLabel,
  error,
  size = 'sm',
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const matches = !typeToConfirm || typed === typeToConfirm;

  const change = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
    if (!next) window.setTimeout(() => setTyped(''), 200);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || confirmDisabled || !matches) return;
    onConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent size={size}>
        <form onSubmit={submit} noValidate className="contents">
          <AlertDialogHeader icon={icon} tone={tone} title={title} description={description} />
          {children || typeToConfirm || error ? (
            <div className="scrollbar-thin grid min-h-0 gap-4 overflow-y-auto px-6 pb-5">
              {children}
              {typeToConfirm ? (
                <Field
                  label={
                    typeToConfirmLabel ?? (
                      <>
                        Type <span className="font-mono font-semibold text-ink">{typeToConfirm}</span> to confirm
                      </>
                    )
                  }
                >
                  <Input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={typeToConfirm}
                    inputClassName="font-mono"
                    disabled={pending}
                  />
                </Field>
              ) : null}
              <FormError message={error ?? undefined} />
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 rounded-b-xl border-t border-line bg-well/40 px-6 py-3.5 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => change(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={confirmVariant} loading={pending} disabled={confirmDisabled || !matches}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
