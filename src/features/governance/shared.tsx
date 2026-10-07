import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function MetricCard({ label, value, detail, icon, warning }: { label: string; value: ReactNode; detail?: ReactNode; icon?: ReactNode; warning?: boolean }) {
  return <Card className="px-5 py-4"><div className="flex items-center justify-between gap-3"><p className="text-[12px] font-medium text-muted">{label}</p><span className={cn('text-brand-600 [&_svg]:size-4', warning && 'text-warning-600')}>{icon}</span></div><p className="mt-2 text-[28px] leading-tight font-semibold tracking-tight tabular text-ink">{value}</p>{detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}</Card>;
}
export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge tone={severity === 'CRITICAL' ? 'danger' : severity === 'WARNING' ? 'warning' : 'neutral'}>{severity.toLowerCase()}</Badge>;
}
export function DetailRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return <dl className="divide-y divide-line text-[13px]">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 py-2.5"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words text-ink">{value ?? '—'}</dd></div>)}</dl>;
}
