import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-production",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "PORT=5174 BASE_PATH=/ NODE_ENV=production pnpm run build && PORT=5174 BASE_PATH=/ NODE_ENV=production pnpm exec vite preview --config vite.config.ts --host 127.0.0.1",
    url: "http://127.0.0.1:5174/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});