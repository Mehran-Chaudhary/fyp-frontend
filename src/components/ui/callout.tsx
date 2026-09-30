import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const calloutVariants = cva('flex gap-3 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed', {
  variants: {
    tone: {
      info: 'border-info-200 bg-info-50 text-info-700',
      success: 'border-success-200 bg-success-50 text-success-700',
      warning: 'border-warning-200 bg-warning-50 text-warning-700',
      danger: 'border-danger-200 bg-danger-50 text-danger-700',
      security: 'border-warning-200 bg-warning-50 text-warning-700',
      neutral: 'border-line bg-well text-ink-soft',
    },
  },
  defaultVariants: { tone: 'info' },
});

const icons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  security: ShieldAlert,
  neutral: Info,
};

interface CalloutProps extends VariantProps<typeof calloutVariants> {
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}

export function Callout({ tone = 'info', title, children, action, icon, className, role }: CalloutProps) {
  const Icon = icons[tone ?? 'info'];
  return (
    <div className={cn(calloutVariants({ tone }), className)} role={role}>
      <span className="mt-px shrink-0 [&_svg]:size-4">{icon ?? <Icon aria-hidden />}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title ? 'mt-0.5 opacity-90' : null)}>{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
