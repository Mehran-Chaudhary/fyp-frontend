import { Outlet, ScrollRestoration } from 'react-router';
import {
  NavigationProgress,
  OfflineBanner,
  RefreshThrottleScreen,
  RefreshUncertainDialog,
} from '@/components/feedback/global-states';

/** Global chrome shared by every route. */
export function RootLayout() {
  return (
    <>
      <NavigationProgress />
      <OfflineBanner />
      <RefreshThrottleScreen />
      <RefreshUncertainDialog />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
