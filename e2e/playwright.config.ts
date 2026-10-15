import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, SESSION } from "./fixtures";

const root = path.join(__dirname, "..");

export default defineConfig({
  testDir: __dirname,
  // One server, one database, specs that share them: one after the other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: path.join(root, "playwright-report") }]] : "list",
  outputDir: path.join(root, "test-results"),
  use: {
    baseURL: BASE_URL,
    // The site's pages are read in French, in Paris time (the kick-offs).
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    // The table layout, from 1024 px (useIsTable); the phone's cards are not
    // what these specs are about.
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, storageState: SESSION },
      dependencies: ["setup"],
    },
  ],
  // The real API on a seeded database (server.ts), started fresh for each run.
  webServer: {
    command: "npx ts-node --project e2e/tsconfig.json e2e/server.ts",
    cwd: root,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
