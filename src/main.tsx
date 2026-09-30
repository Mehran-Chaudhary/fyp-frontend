import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './styles/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { installGlobalErrorHandler } from './lib/api/global-handler';
import { bootstrapSession } from './lib/auth/session';

// Wire app-wide error reactions and start restoring the session before React
// renders. Both run exactly once per page load, outside React, so StrictMode's
// double effects can never produce a second refresh (spec §4.2).
installGlobalErrorHandler();
void bootstrapSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
