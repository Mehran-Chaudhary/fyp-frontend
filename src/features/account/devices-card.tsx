import { useMutation, useQuery } from '@tanstack/react-query';
import { Laptop, LogOut, Monitor, MonitorSmartphone, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { authApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { Session } from '@/lib/api/types';
import { queryKeys, sessionsQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast, toastError } from '@/lib/toast';
import { cn, formatDate, formatRelative, pluralize } from '@/lib/utils';

function deviceIcon(label: string | null) {
  const text = (label ?? '').toLowerCase();
  if (text.includes('ipad') || text.includes('tablet')) return Tablet;
  if (text.includes('android') || text.includes('ios') || text.includes('iphone')) return Smartphone;
  if (text.includes('mac') || text.includes('chrome os') || text.includes('chromeos')) return Laptop;
  if (text.includes('unknown')) return MonitorSmartphone;
  return Monitor;
}

/** Signed-in devices (spec §7.13 card 3, E14/E15). */
export function DevicesCard() {
  const sessions = useQuery(sessionsQuery);
  const [pending, setPending] = useState<Session | null>(null);

  const revoke = useMutation({
    mutationFn: (session: Session) => authApi.revokeSession(session.id),
    onSuccess: (_result, session) => {
      toast.success('Device signed out', {
        description: `${session.deviceLabel ?? 'That device'} will be signed out within 15 minutes.`,
      });
    },
    onError: (error) => {
      if (hasCode(error, 'AUTH_SESSION_NOT_FOUND')) {
        toast.info('Already signed out', { description: 'That device had already ended its session.' });
      } else {
        toastError(error, "Couldn't sign that device out");
      }
    },
    onSettled: () => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });

  const list = sessions.data ? [...sessions.data].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)) : [];

  return (
    <Card>
      <CardHeader
        icon={<MonitorSmartphone />}
        title="Devices"
        description={
          sessions.data
            ? `${pluralize(sessions.data.length, 'device')} signed in to your account.`
            : 'Browsers and apps signed in to your account.'
        }
      />
      <div className="border-t border-line">
        {sessions.isPending ? (
          <ul>
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
        ) : (
          <ul>
            {list.map((session, index) => {
              const Icon = deviceIcon(session.deviceLabel);
              return (
                <li
                  key={session.id}
                  className={cn('flex items-center gap-4 px-5 py-4 sm:px-6', index > 0 && 'border-t border-line/70')}
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
                    <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-ink">
                      {session.deviceLabel ?? 'Unknown device'}
                      {session.isCurrent ? <Badge tone="brand">This device</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">
                      {session.ipAddress ? <span className="font-mono">{session.ipAddress}</span> : 'IP unknown'}
                      <span aria-hidden> · </span>
                      Signed in {formatDate(session.createdAt)}
                      <span aria-hidden> · </span>
                      {session.isCurrent ? 'Active now' : `Last active ${formatRelative(session.lastUsedAt, 'unknown')}`}
                    </p>
                  </div>
                  {session.isCurrent ? null : (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={revoke.isPending && revoke.variables?.id === session.id}
                      onClick={() => setPending(session)}
                    >
                      Sign out
                    </Button>
                  )}
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
            title={`Sign out ${pending?.deviceLabel ?? 'this device'}?`}
            description="It will be signed out within 15 minutes, when its current access expires, and will need your password to get back in."
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
