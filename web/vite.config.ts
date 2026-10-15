import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Start times are shown in the local time zone: pin it so the expected
    // strings are the same in CI (UTC) and on a machine in France.
    env: { TZ: "Europe/Paris" },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
