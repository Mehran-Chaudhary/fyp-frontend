import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type CSSProperties } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IS_DEV } from '@/lib/env';
import { queryClient } from '@/lib/query-client';
import { router } from './router';

// Opt-in: VITE_QUERY_DEVTOOLS=true in .env.development.local
const QueryDevtools = IS_DEV && import.meta.env.VITE_QUERY_DEVTOOLS === 'true'
  ? lazy(() => import('@tanstack/react-query-devtools').then((module) => ({ default: module.ReactQueryDevtools })))
  : null;

const toasterStyle = {
  '--normal-bg': 'var(--color-surface)',
  '--normal-border': 'var(--color-line)',
  '--normal-text': 'var(--color-ink)',
  '--border-radius': '12px',
  fontFamily: 'var(--font-sans)',
} as CSSProperties;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={250} skipDelayDuration={150}>
        <RouterProvider router={router} />
        <Toaster
          position="bottom-right"
          theme="light"
          closeButton
          visibleToasts={4}
          style={toasterStyle}
          toastOptions={{
            classNames: {
              toast: 'shadow-pop! text-[13px]!',
              title: 'font-semibold! text-ink!',
              description: 'text-muted! leading-relaxed!',
            },
          }}
        />
      </TooltipProvider>
      {QueryDevtools ? (
        <Suspense fallback={null}>
          <QueryDevtools buttonPosition="bottom-left" />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
}
