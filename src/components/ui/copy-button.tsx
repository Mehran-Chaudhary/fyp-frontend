import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyToClipboard } from '@/lib/utils';
import { Button, type ButtonProps } from './button';

interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  value: string;
  label?: string;
  copiedLabel?: string;
  iconOnly?: boolean;
}

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  iconOnly,
  variant = 'secondary',
  size = 'sm',
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant={variant}
      size={iconOnly ? 'icon-sm' : size}
      aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
      onClick={async () => {
        if (await copyToClipboard(value)) setCopied(true);
      }}
      {...props}
    >
      {copied ? <Check className="text-brand-600" /> : <Copy />}
      {iconOnly ? null : <span aria-live="polite">{copied ? copiedLabel : label}</span>}
    </Button>
  );
}
