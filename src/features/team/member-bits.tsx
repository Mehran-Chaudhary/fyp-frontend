import { Crown } from 'lucide-react';
import type { Member, MemberRole, MembershipStatus } from '@/lib/api/types';
import { withAlpha } from '@/lib/color';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/misc';

/** A role as a chip, tinted with its colour (neutral when it has none). */
export function RoleChip({
  role,
  className,
  size = 'sm',
}: {
  role: Pick<MemberRole, 'name' | 'color'>;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const tint = withAlpha(role.color, 0.09);
  const border = withAlpha(role.color, 0.32);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border font-medium whitespace-nowrap text-ink-soft',
        size === 'sm' ? 'px-1.5 py-px text-[11.5px] leading-[18px]' : 'px-2 py-0.5 text-[12.5px] leading-5',
        tint ? null : 'border-line bg-well',
        className,
      )}
      style={tint ? { backgroundColor: tint, borderColor: border } : undefined}
    >
      <RoleDot color={role.color} />
      <span className="truncate">{role.name}</span>
    </span>
  );
}

export function RoleDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', color ? null : 'bg-faint', className)}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/** The member's roles, highest first; the built-in owner role is implied by the Owner badge. */
export function RoleChips({ member, className }: { member: Pick<Member, 'roles' | 'isOwner'>; className?: string }) {
  const roles = [...member.roles]
    .filter((role) => !(member.isOwner && role.slug === 'owner'))
    .sort((a, b) => b.priority - a.priority);
  if (roles.length === 0 && !member.isOwner) return <span className="text-faint">—</span>;
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {member.isOwner ? <OwnerBadge /> : null}
      {roles.map((role) => (
        <RoleChip key={role.id} role={role} />
      ))}
    </span>
  );
}

export function OwnerBadge() {
  return (
    <Badge tone="brand">
      <Crown />
      Owner
    </Badge>
  );
}

const STATUS: Record<MembershipStatus, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'warning' },
  REMOVED: { label: 'Removed', tone: 'neutral' },
};

export function MemberStatusBadge({ status }: { status: MembershipStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

/** Avatar, name with "You" / "Owner" markers, and the email underneath. */
export function MemberIdentity({
  member,
  isYou,
  size = 'md',
  className,
}: {
  member: Pick<Member, 'displayName' | 'email' | 'avatarUrl' | 'isOwner' | 'status'>;
  isYou?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const removed = member.status === 'REMOVED';
  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)}>
      <Avatar name={member.displayName} src={member.avatarUrl} size={size === 'sm' ? 'sm' : 'md'} muted={removed} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('truncate font-medium', removed ? 'text-muted' : 'text-ink')}>{member.displayName}</span>
          {isYou ? (
            <span className="shrink-0 rounded border border-line bg-well px-1 text-[10.5px] leading-4 font-medium text-muted">
              You
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted">{member.email}</span>
      </span>
    </span>
  );
}
