import { cn, formatDateTime, formatRelative } from '@/lib/utils';
import { Tooltip } from './tooltip';

/** "3 days ago", with the full date and time on hover or focus. */
export function RelativeTime({
  value,
  fallback = '—',
  className,
}: {
  value: string | null | undefined;
  fallback?: string;
  className?: string;
}) {
  if (!value) return <span className={cn('text-faint', className)}>{fallback}</span>;
  return (
    <Tooltip content={formatDateTime(value)}>
      <time dateTime={value} tabIndex={0} className={cn('rounded-sm whitespace-nowrap', className)}>
        {formatRelative(value)}
      </time>
    </Tooltip>
  );
}
