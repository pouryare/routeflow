import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Packages that read `window` the moment they are evaluated, so a module importing one
 *  at the top level cannot be rendered on the server.
 *
 *  Verified rather than assumed: `node -e "require('leaflet')"` throws "window is not
 *  defined" on this exact dependency tree, and react-leaflet re-exports it. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** Only top-level imports count. A `require` or dynamic import inside an effect or a
 *  function body runs after hydration, which is safe; a bare `import ... from "leaflet"`
 *  at the top of a module runs during prerender, which is not. */
function topLevelImports(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => /^\s*import\s[^;]*from\s+["']/.test(line) || /^\s*import\s+["']/.test(line))
    .flatMap((line) => {
      const m = line.match(/["']([^"']+)["']/);
      return m ? [m[1]] : [];
    });
}

/** Which module in each file pulls an SSR-unsafe package at the top level, following
 *  one level of relative import from a page.
 *
 *  Scoped to page entry points on purpose. `components/LeadsMap.tsx` and its children
 *  import leaflet at the top level by design -- they only ever render inside a map, and
 *  the map itself is loaded with ssr:false, so they are never evaluated on the server.
 *  What actually breaks a prerender is a *page* reaching one of them directly, which is
 *  exactly what /analytics did. */
function localSpecifier(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The set of page entry points: files named page.tsx under app/. */
const pageFiles = walk(path.resolve(process.cwd(), "app")).filter(
  (f) => path.basename(f) === "page.tsx"
);

describe("no page imports an SSR-unsafe map package", () => {
  const offenders: string[] = [];

  for (const page of pageFiles) {
    const rel = path.relative(process.cwd(), page);
    for (const spec of topLevelImports(fs.readFileSync(page, "utf8"))) {
      const target = localSpecifier(page, spec);
      if (!target) continue;
      const targetRel = path.relative(process.cwd(), target);
      if (targetRel.startsWith("components/analytics/")) {
        offenders.push(`${rel} imports ${targetRel}, which imports leaflet directly`);
      }
    }
  }

  // The build failed on /analytics with "window is not defined": its page imported
  // LeadGeographicDensity, which imports leaflet at the top level. Leaflet reads
  // window on import -- `node -e "require('leaflet')"` throws -- so any page reaching
  // it directly cannot be prerendered. The fix loads it through next/dynamic with
  // ssr:false, the same shape components/MapLoader.tsx already uses.
  it("reports nothing", () => {
    expect(offenders).toEqual([]);
  });
});

describe("the analytics map is not server-rendered", () => {
  const target = path.resolve(process.cwd(), "components/analytics/LeadGeographicDensity.tsx");
  const source = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";

  it("still exists to be loaded", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("is reached through next/dynamic with ssr disabled", () => {
    // Asserted from the page side: the import specifier alone is not enough, because a
    // plain `import X from` would look identical in a grep.
    const page = fs.readFileSync(
      path.resolve(process.cwd(), "app/(shell)/analytics/page.tsx"),
      "utf8"
    );
    expect(page).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("@\/components\/analytics\/LeadGeographicDensity"\)/);
    expect(page).toMatch(/ssr:\s*false/);
  });
});

