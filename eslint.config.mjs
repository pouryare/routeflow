import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /* A nested git worktree -- a second, full checkout of this app. `eslint` with no
       arguments walked it as if it were source, which is where roughly 12,200 of the
       12,264 problems `npm run lint` used to report came from, and why the command was
       not worth running. A separate checkout lints on its own terms. */
    ".claude/**",
  ]),
]);

export default eslintConfig;
