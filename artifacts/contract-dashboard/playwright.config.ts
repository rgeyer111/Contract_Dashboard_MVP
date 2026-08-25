import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "PORT=5173 BASE_PATH=/ NODE_ENV=development pnpm exec vite --config vite.config.ts",
    url: "http://127.0.0.1:5173/",
    reuseExistingServer: true,
  },
});