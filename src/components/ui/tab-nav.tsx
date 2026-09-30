import type { LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { cn } from '@/lib/utils';

export interface TabNavItem {
  to: string;
  label: string;
  icon?: LucideIcon;
  /** Decides whether the tab is current. Default: exact match, or a sub-path of `to`. */
  isActive?: (pathname: string) => boolean;
}

/** Route-backed tabs under a page header (Team, Settings). */
export function TabNav({ items, className, 'aria-label': ariaLabel }: { items: TabNavItem[]; className?: string; 'aria-label': string }) {
  const { pathname } = useLocation();
  const trimmed = pathname.replace(/\/+$/, '');

  return (
    <nav aria-label={ariaLabel} className={cn('border-b border-line', className)}>
      <ul className="scrollbar-thin -mb-px flex gap-1 overflow-x-auto">
        {items.map(({ to, label, icon: Icon, isActive }) => {
          const active = isActive ? isActive(trimmed) : trimmed === to || trimmed.startsWith(`${to}/`);
          return (
            <li key={to} className="shrink-0">
              <Link
                to={to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-10 items-center gap-2 rounded-t-md px-3 text-[13.5px] whitespace-nowrap transition-colors',
                  'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors',
                  active
                    ? 'font-medium text-ink after:bg-brand-600'
                    : 'text-muted after:bg-transparent hover:text-ink hover:after:bg-line-strong',
                )}
              >
                {Icon ? <Icon className={cn('size-4', active ? 'text-brand-600' : 'text-faint')} aria-hidden /> : null}
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
