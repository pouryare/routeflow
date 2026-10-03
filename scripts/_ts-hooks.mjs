/** Module-resolution hook that lets a plain `node` script import the app's own modules.
 *
 *  `node --experimental-strip-types` runs .ts, but it resolves imports with Node's rules
 *  and none of them are this project's rules. Three gaps, all load-bearing:
 *
 *    1. `@/x` is a tsconfig path alias. Node knows nothing about tsconfig.
 *    2. `lib/repo/ledger.ts` imports `"./payments"` — no extension. Node ESM requires one.
 *    3. `lib/session.ts:1` imports `next/server` as a VALUE, and `lib/repo/margin.ts:14`
 *       imports a value (`orderFilter`) from it. `next/server` is not resolvable outside
 *       Next's bundler, and because it is not a type-only import, stripping cannot erase
 *       it. A stub is the answer: the seed never calls NextRequest or NextResponse.
 *    4. Fixing (2) naively breaks `node_modules`: `web-push` is CommonJS and uses
 *       extensionless requires that Node's own CJS loader resolves correctly. So (2) is
 *       applied only to our own files — see `isOurFile` below.
 *
 *  (1)-(3) and (4) are each covered by a test in tests/ts-hooks.test.ts, and all four were
 *  mutation-verified: removing any one of them turns that file red.
 *
 *  This is why every existing script re-declares the schema by hand — see the comment at
 *  scripts/seed-districts.ts:11-13. That workaround cost the repo three seed scripts and
 *  is what let demo data drift away from the app's business rules.
 *
 *  `registerHooks` rather than `register`: the latter is [DEP0205] as of Node 26.
 */
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** `next/server` as an importable stub. Only what a module might destructure at load time.
 *
 *  Written with newlines rather than concatenated onto one line: a data: URL keeps its
 *  source exactly as given, so `export class X {}export const Y` on one line is a
 *  SyntaxError at parse time, not something ASI rescues. Newlines make each statement
 *  unambiguous. */
const NEXT_STUB = [
  "data:text/javascript,",
  "export class NextRequest {}",
  "export const NextResponse = {",
  "  json: () => ({}), redirect: () => {}, next: () => ({}),",
  "  cookies: { get: () => undefined, set: () => {}, delete: () => {} },",
  "};",
  "export const NextHeaders = undefined;",
].join("\n");

/** The file to load for a specifier, or null. Exact file before directory, always. */
function resolveFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) return candidate;
  }
  return null;
}

/** Only OUR files get the extension treatment. `node_modules` is Node's own problem.
 *
 *  `web-push` — reached via `lib/push.ts` — is CommonJS and uses extensionless requires
 *  like `"./vapid-helper"`. Those resolve fine under Node's CJS loader, but rewriting them
 *  to `./vapid-helper.js` as if they were ESM breaks the package. Anything under
 *  node_modules is therefore passed straight through untouched. */
function isOurFile(abs) {
  return !abs.includes(`${path.sep}node_modules${path.sep}`);
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = resolveFile(path.join(ROOT, specifier.slice(2)));
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }
  if (specifier.startsWith(".") && context.parentURL) {
    const parentDir = path.dirname(new URL(context.parentURL).pathname);
    const abs = path.resolve(parentDir, specifier);
    if (isOurFile(abs)) {
      const found = resolveFile(abs);
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }
  }
  if (specifier.startsWith("next/")) {
    return nextResolve(NEXT_STUB, context);
  }
  return nextResolve(specifier, context);
}
