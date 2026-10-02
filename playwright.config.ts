import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: {
    channel: 'chrome',
    baseURL: 'http://localhost:5174',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:5174', reuseExistingServer: true, timeout: 30_000 },
});
