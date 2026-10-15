import { defineConfig } from "vitest/config";

// web/ is a separate, independently tested package (its own vitest config,
// jsdom environment, and node_modules) — exclude it here so the backend's
// `npm run test` doesn't try to run frontend tests under the node environment.
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "web/**",
      // Playwright's own specs, run by `npm run e2e`.
      "e2e/**",
    ],
  },
});
