import { defineConfig } from "vitest/config";
import path from "node:path";

const dirname = path.dirname(new URL(import.meta.url).pathname);


/** Separate config because these need a browser and a server, so they are slow and must
 *  not run inside the unit suite's watch loop. They still run in `npm test` — a ratchet
 *  behind a script nobody types is not a ratchet. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/smoke/**/*.test.ts"],
    /* Loads .env.local inside the worker, where SESSION_SECRET is actually needed. */
    setupFiles: ["tests/smoke/setup.ts"],
    testTimeout: 90_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(dirname, ".") } },
});
