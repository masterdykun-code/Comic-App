import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// Isolated frontend; every API request is intercepted by the specs, never a real Backend.
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5185' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5185 --strictPort',
    env: { VITE_API_BASE_URL: 'http://localhost:4000/api' },
    url: 'http://127.0.0.1:5185',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
