/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Optional proxy for relative API URLs. Local .env uses an absolute API URL,
  // so browser requests go directly to the backend and exercise its CORS policy.
  const backend = env.BACKEND_URL || 'http://localhost:3000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      // The backend's emails link to http://localhost:5173 and CORS allows exactly
      // that origin, so the port must not drift.
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/health': { target: backend, changeOrigin: true },
      },
    },
    preview: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/health': { target: backend, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      restoreMocks: true,
    },
  };
});
