import { defineConfig } from "vitest/config";
import path from "node:path";

const dirname = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["tests/setup-pg.ts"],
    include: ["tests/**/*.test.ts"],
    /* The smoke suite boots a browser and a dev server. It has its own config
       (vitest.smoke.mts) and must not be collected twice. */
    exclude: ["tests/smoke/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
    },
  },
});
