import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyToClipboard } from '@/lib/utils';
import { Button, type ButtonProps } from './button';

interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  value: string;
  label?: string;
  copiedLabel?: string;
  failedLabel?: string;
  iconOnly?: boolean;
  /** Told about every attempt, so a caller can explain a blocked clipboard in place. */
  onCopyResult?: (ok: boolean) => void;
}

/**
 * Copies on click only (never on render). A browser can refuse the clipboard
 * (permissions, insecure origin), and that is said out loud rather than
 * silently ignored: for a one-time secret the user must know to copy it by hand.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  failedLabel = "Couldn't copy",
  iconOnly,
  variant = 'secondary',
  size = 'sm',
  onCopyResult,
  ...props
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), state === 'failed' ? 4_000 : 1_800);
    return () => window.clearTimeout(timer);
  }, [state]);

  const text = state === 'copied' ? copiedLabel : state === 'failed' ? failedLabel : label;

  return (
    <Button
      variant={variant}
      size={iconOnly ? 'icon-sm' : size}
      aria-label={iconOnly ? text : undefined}
      title={iconOnly ? text : undefined}
      onClick={async () => {
        const ok = await copyToClipboard(value);
        setState(ok ? 'copied' : 'failed');
        onCopyResult?.(ok);
      }}
      {...props}
    >
      {state === 'copied' ? (
        <Check className="text-brand-600" />
      ) : state === 'failed' ? (
        <TriangleAlert className="text-warning-600" />
      ) : (
        <Copy />
      )}
      {iconOnly ? null : <span aria-live="polite">{text}</span>}
    </Button>
  );
}
