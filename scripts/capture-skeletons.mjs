// Records every shell page's layout as skeleton boxes, for components/meridian/PageSkeleton.tsx.
//
//   DATABASE_URL=postgres://… bash scripts/preview.sh      # in one terminal (demo data, never live)
//   DEMO_PASSWORD=… npm run skeletons:capture              # in another; --only=/sales/orders for one page
//
// CI runs it for you: .github/workflows/skeletons.yml recaptures when a PR touches page or style
// files and commits the result to the branch. By hand, rerun it after a layout change and commit
// lib/skeletons/. A page whose new capture is within a few pixels of the stored one keeps the
// stored file, so run-to-run jitter never makes a diff.
//
// For each route with a loading.tsx it logs in as the first demo role the page lets in, opens
// the page right to left at phone and desktop width, waits for its data, and runs boneyard's
// snapshotBones (node_modules/boneyard-js, MIT) on the page body. The header card is left out:
// loading.tsx draws the real one. Fixed bars, boxes clipped out of view, screen-reader text
// and anything below the first screen are dropped.
// Output: lib/skeletons/<route>.json and the generated lib/skeletons/index.ts.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { sameCapture } from "./skeleton-compare.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "lib/skeletons");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const BASE = arg("base") ?? `http://127.0.0.1:${process.env.PORT ?? 3099}`;
const ONLY = arg("only");
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) {
  console.error("DEMO_PASSWORD is required (the password seed:demo gave the demo logins)");
  process.exit(2);
}

/* The first role a page does not redirect is the one captured: owner sees nearly everything. */
const ROLES = ["demo.owner", "demo.platform", "demo.gm", "demo.rep_lead", "demo.sales", "demo.field", "demo.driver"];
const WIDTHS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 900 } };
/* A dynamic route is captured on the first record its list page links to. */
const DYNAMIC_FROM = {
  "/crm/[id]": ["/crm", "/sales/data-quality"],
  "/sales/orders/[id]": ["/sales/orders", "/sales/today"],
  "/sales/reps/[id]": ["/sales/reps"],
  "/accounting/suppliers/[supplierId]": ["/accounting/suppliers", "/accounting/payables"],
  "/accounting/ledger/[accountId]": ["/accounting/trial-balance"],
};

/* extract.js has no imports; loaded as a classic script so the page can call it. */
const EXTRACT = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.resolve("boneyard-js"))), "extract.js"), "utf8")
  .replace(/^export /gm, "")
  .concat("\nwindow.__snapshotBones = snapshotBones;");

function routes() {
  const shell = path.join(ROOT, "app/(shell)");
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "loading.tsx") {
        const segs = path.relative(shell, dir).split(path.sep).filter((s) => s && !s.startsWith("("));
        found.push("/" + segs.join("/"));
      }
    }
  };
  walk(shell);
  return found.sort();
}

const fileFor = (route) => route.slice(1).replace(/[[\]]/g, "").replaceAll("/", "-") || "root";

async function resolvePath(page, route) {
  if (!route.includes("[")) return route;
  const pattern = new RegExp("^" + route.replace(/\[[^\]]+\]/g, "\\d+") + "$");
  for (const from of DYNAMIC_FROM[route] ?? []) {
    await page.goto(BASE + from, { waitUntil: "networkidle" });
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    const hit = hrefs.find((h) => h && pattern.test(h.split("?")[0]));
    if (hit) return hit.split("?")[0];
  }
  return null;
}

async function snapshot(page) {
  await page.addScriptTag({ content: EXTRACT });
  return page.evaluate((cap) => {
    const root = document.querySelector(".route-fade");
    if (!root) return null;
    const top = root.getBoundingClientRect().top;
    const header = root.querySelector(":scope > .phcwrap");
    const offset = header
      ? header.getBoundingClientRect().bottom + parseFloat(getComputedStyle(header).marginBottom) - top
      : 0;
    /* boneyard measures boxes, not what shows: a fixed bar, a chip scrolled out of its row or
       a price-roll digit hidden by its column's overflow would all be drawn. Skipped here. */
    const clips = (el) => {
      const s = getComputedStyle(el);
      return s.overflowX !== "visible" || s.overflowY !== "visible";
    };
    for (const el of root.querySelectorAll("*")) {
      if (getComputedStyle(el).position === "fixed") { el.setAttribute("data-skeleton-skip", ""); continue; }
      let { left, right, top: t, bottom } = el.getBoundingClientRect();
      for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
        if (!clips(a)) continue;
        const c = a.getBoundingClientRect();
        left = Math.max(left, c.left); right = Math.min(right, c.right);
        t = Math.max(t, c.top); bottom = Math.min(bottom, c.bottom);
      }
      if (right - left < 1 || bottom - t < 1) el.setAttribute("data-skeleton-skip", "");
    }
    const snap = window.__snapshotBones(root, "page", {
      excludeSelectors: [".phcwrap", ".sr-only", "[data-skeleton-skip]", "[role=status]"],
    });
    const limit = cap - offset;
    const bones = [];
    for (const b of snap.bones) {
      const y = Math.round(b.y - offset);
      if (y >= limit || y + b.h <= 0) continue;
      const h = Math.round(Math.min(b.h, limit - y));
      const r = typeof b.r === "number" ? Math.round(b.r) : b.r;
      const x0 = Math.max(0, b.x), x1 = Math.min(100, b.x + b.w);
      if (x1 - x0 < 0.5) continue;
      const bone = [+x0.toFixed(1), y, +(x1 - x0).toFixed(1), h, r];
      if (b.c) bone.push(1);
      /* Neighbouring spans on one line (the digits of a rolling price, the words of a label)
         become one bar, the way a line of text reads, instead of a row of stubs. */
      const m = bones[bones.length - 1];
      const gap = m && (Math.max(m[0], bone[0]) - Math.min(m[0] + m[2], bone[0] + bone[2])) * (snap.width / 100);
      if (m && !m[5] && !bone[5] && m[1] === bone[1] && m[3] === bone[3] && gap <= 8) {
        const x = Math.min(m[0], bone[0]);
        m[2] = +(Math.max(m[0] + m[2], bone[0] + bone[2]) - x).toFixed(1);
        m[0] = x;
        continue;
      }
      bones.push(bone);
    }
    const height = Math.round(Math.min(Math.max(0, ...bones.map((b) => b[1] + b[3])), limit));
    return { height, bones };
  }, page.viewportSize().height);
}

/* Waits for the page's own placeholders to go: client pages fetch after hydration. */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".route-fade .skeleton"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/* CHROMIUM_PATH: a Chromium other than the one this Playwright version downloads. The GL flags
   let MapLibre draw its canvas headless, as in gen-basemap-thumbs.mjs. */
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
/* One login per role per run: /api/login allows 30 attempts per address in 15 minutes. */
const contexts = new Map();
async function pageFor(role, size) {
  if (!contexts.has(role)) contexts.set(role, await login(role));
  const page = await contexts.get(role).newPage();
  await page.setViewportSize(size);
  return page;
}
async function login(role) {
  const ctx = await browser.newContext({
    locale: "fa-IR", colorScheme: "light", reducedMotion: "reduce", bypassCSP: true,
  });
  const res = await ctx.request.post(BASE + "/api/login", { data: { username: role, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login ${role}: ${res.status()} ${await res.text()}`);
  return ctx;
}

mkdirSync(OUT, { recursive: true });
function readStored(file) {
  try { return JSON.parse(readFileSync(path.join(OUT, file), "utf8")); } catch { return null; }
}

const report = [];
for (const route of routes()) {
  if (ONLY && route !== ONLY) continue;
  let done = null;
  for (const role of ROLES) {
    const page = await pageFor(role, WIDTHS.phone);
    const target = await resolvePath(page, route);
    if (!target) { await page.close(); continue; }
    await page.goto(BASE + target, { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname !== target) { await page.close(); continue; }
    await settle(page);
    const phone = await snapshot(page);
    await page.close();
    if (!phone || phone.bones.length === 0) continue;
    const wide = await pageFor(role, WIDTHS.desktop);
    await wide.goto(BASE + target, { waitUntil: "domcontentloaded" });
    await settle(wide);
    const desktop = await snapshot(wide);
    await wide.close();
    done = { role, target, phone, desktop: desktop?.bones.length ? desktop : undefined };
    break;
  }
  if (!done) { report.push(`  ✗ ${route}: no demo role reached it with content; keeps its fallback shape`); continue; }
  const file = `${fileFor(route)}.json`;
  const next = { route, phone: done.phone, desktop: done.desktop };
  const stored = readStored(file);
  const kept = stored && sameCapture(stored, next);
  if (!kept) writeFileSync(path.join(OUT, file), JSON.stringify(next) + "\n");
  report.push(`  ${kept ? "=" : "✓"} ${route} as ${done.role} (${done.target}): ${done.phone.bones.length} phone / ${done.desktop?.bones.length ?? 0} desktop boxes${kept ? " (unchanged)" : ""}`);
}
await browser.close();

/* The index imports every capture on disk, so a page captured earlier keeps its file. */
const files = readdirSync(OUT).filter((f) => f.endsWith(".json")).sort();
const entries = files.map((f) => ({ f, route: JSON.parse(readFileSync(path.join(OUT, f), "utf8")).route }));
const ident = (f) => "c_" + f.replace(/\.json$/, "").replace(/[^a-z0-9]/gi, "_");
writeFileSync(
  path.join(OUT, "index.ts"),
  `// Generated by scripts/capture-skeletons.mjs (npm run skeletons:capture). Do not edit by hand.
/** One box: x and width in % of the page width, y and height in px, corner radius, 1 = a card. */
export type CapturedBone = [number, number, number, number, number | string, 1?];
type CapturedLayout = { height: number; bones: CapturedBone[] };
export type Capture = { route: string; phone: CapturedLayout; desktop?: CapturedLayout };

${entries.map(({ f }) => `import ${ident(f)} from "./${f}";`).join("\n")}

export const CAPTURES: Record<string, Capture> = {
${entries.map(({ f, route }) => `  ${JSON.stringify(route)}: ${ident(f)} as Capture,`).join("\n")}
};
`,
);
console.log(report.join("\n"));
