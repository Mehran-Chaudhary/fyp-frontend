import { useMutation, useQuery } from '@tanstack/react-query';
import { Laptop, LogOut, Monitor, MonitorSmartphone, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { Tooltip } from '@/components/ui/tooltip';
import { authApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { Session } from '@/lib/api/types';
import { endSessionLocally } from '@/lib/auth/session';
import { queryKeys, sessionsQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast, toastError } from '@/lib/toast';
import { cn, formatDate, formatDateTime, formatRelative, pluralize } from '@/lib/utils';

function deviceIcon(label: string | null) {
  const text = (label ?? '').toLowerCase();
  if (text.includes('ipad') || text.includes('tablet')) return Tablet;
  if (text.includes('android') || text.includes('ios') || text.includes('iphone')) return Smartphone;
  if (text.includes('mac') || text.includes('chrome os') || text.includes('chromeos')) return Laptop;
  if (!text || text.includes('unknown')) return MonitorSmartphone;
  return Monitor;
}

/**
 * Signed-in devices (P1-API-19, P1-API-20). One row per device: token rotations
 * collapse into it, and its id is the session id to revoke. Refreshed by hand,
 * never polled.
 */
export function DevicesCard() {
  const sessions = useQuery(sessionsQuery);
  const [pending, setPending] = useState<Session | null>(null);

  const revoke = useMutation({
    mutationFn: (session: Session) => authApi.revokeSession(session.id),
    onSuccess: (_result, session) => {
      if (session.isCurrent) {
        // This browser's own session: leave at once. The cookie stays behind but is
        // revoked, and this browser won't try to restore it (spec §6 "Devices").
        endSessionLocally('device-signed-out');
        return;
      }
      toast.success('Device signed out', {
        description: `${session.deviceLabel ?? 'That device'} can't renew its session any more and is signed out within 15 minutes.`,
      });
    },
    onError: (error) => {
      if (hasCode(error, 'AUTH_SESSION_NOT_FOUND')) {
        toast.info('Already signed out', { description: 'That device had already ended its session. The list is up to date now.' });
      } else {
        toastError(error, "Couldn't sign that device out");
      }
    },
    onSettled: (_data, _error, session) => {
      setPending(null);
      if (!session.isCurrent) void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });

  const list = sessions.data ? [...sessions.data].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)) : [];

  return (
    <Card id="devices" className="scroll-mt-20">
      <CardHeader
        icon={<MonitorSmartphone />}
        title="Devices"
        description={
          sessions.data
            ? `${pluralize(sessions.data.length, 'device')} signed in to your account.`
            : 'Browsers and apps signed in to your account.'
        }
        actions={
          <Tooltip content="Refresh the list">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh the device list"
              disabled={sessions.isFetching}
              onClick={() => void sessions.refetch()}
            >
              <RefreshCw className={cn(sessions.isFetching && 'animate-spin motion-reduce:animate-none')} />
            </Button>
          </Tooltip>
        }
      />
      <div className="border-t border-line">
        {sessions.isPending ? (
          <ul aria-busy="true">
            {[0, 1].map((index) => (
              <li key={index} className={cn('flex items-center gap-4 px-5 py-4 sm:px-6', index > 0 && 'border-t border-line/70')}>
                <Skeleton className="size-9 rounded-lg" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
              </li>
            ))}
          </ul>
        ) : sessions.isError ? (
          <ErrorState compact error={sessions.error} onRetry={() => void sessions.refetch()} retrying={sessions.isFetching} />
        ) : list.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted sm:px-6">No active devices were found.</p>
        ) : (
          <ul>
            {list.map((session, index) => {
              const Icon = deviceIcon(session.deviceLabel);
              return (
                <li
                  key={session.id}
                  className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:flex-nowrap sm:px-6', index > 0 && 'border-t border-line/70')}
                >
                  <span
                    className={cn(
                      'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border',
                      session.isCurrent ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-well text-ink-soft',
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium break-words text-ink">
                      {session.deviceLabel || 'Unknown device'}
                      {session.isCurrent ? <Badge tone="brand">This device</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">
                      {session.ipAddress ? <span className="font-mono">{session.ipAddress}</span> : 'IP address not recorded'}
                      <span aria-hidden> · </span>
                      <span title={formatDateTime(session.createdAt)}>Signed in {formatDate(session.createdAt)}</span>
                      <span aria-hidden> · </span>
                      {session.isCurrent
                        ? 'Active now'
                        : session.lastUsedAt
                          ? `Last active ${formatRelative(session.lastUsedAt)}`
                          : 'Last activity not recorded'}
                    </p>
                  </div>
                  <Button
                    variant={session.isCurrent ? 'ghost' : 'secondary'}
                    size="sm"
                    className="ml-auto"
                    loading={revoke.isPending && revoke.variables?.id === session.id}
                    disabled={revoke.isPending && revoke.variables?.id !== session.id}
                    onClick={() => setPending(session)}
                  >
                    Sign out
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && !revoke.isPending && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader
            icon={<LogOut />}
            tone="warning"
            title={pending?.isCurrent ? 'Sign out of this device?' : `Sign out ${pending?.deviceLabel || 'this device'}?`}
            description={
              pending?.isCurrent
                ? "You'll be signed out here right away. Your other devices stay signed in."
                : "It can't renew its session any more, so it is signed out within 15 minutes, when its current access expires. It will need your password to get back in."
            }
          />
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-well/40 px-6 py-3.5 sm:flex-row sm:justify-end">
            <AlertDialogCancel asChild>
              <Button variant="ghost" disabled={revoke.isPending}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button variant="danger" loading={revoke.isPending} onClick={() => pending && revoke.mutate(pending)}>
              Sign out device
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
