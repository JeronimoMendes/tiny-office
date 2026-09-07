import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 90000,
  // A client that runs out of unacknowledged inputs stops walking until the
  // server catches up, so a starved runner can hold a position for seconds
  // before it resumes. Wait past that rather than read it as a stall.
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3010',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  reporter: 'list',
});
