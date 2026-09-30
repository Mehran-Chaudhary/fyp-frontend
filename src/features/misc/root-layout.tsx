import { Outlet, ScrollRestoration } from 'react-router';
import { NavigationProgress, OfflineBanner, RefreshThrottleScreen } from '@/components/feedback/global-states';

/** Global chrome shared by every route. */
export function RootLayout() {
  return (
    <>
      <NavigationProgress />
      <OfflineBanner />
      <RefreshThrottleScreen />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
