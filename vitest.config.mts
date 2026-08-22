import { defineConfig } from "vitest/config";
import path from "node:path";

const dirname = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
    },
  },
});
