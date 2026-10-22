import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

/* Cross-tenant guardrail over EVERY api route (architecture audit, step 1).
 *
 * The data layer enforces tenancy by convention: each query has to remember its own
 * organization_id. This file is the net under that convention. It signs in as the owner of
 * organisation A, calls every exported handler of every route.ts, and feeds the dynamic
 * segments the ids that belong to organisation B. Two things must hold afterwards:
 *   - nothing B owns came back (B's text columns carry a marker that no response may contain);
 *   - nothing B owns changed (a fingerprint of every organization_id row of org 2).
 * A third test calls every handler with no cookie at all. A new route is picked up by the
 * directory walk, so nobody has to remember to register it here. */

const testDbPath = path.join(os.tmpdir(), `rf-tenancy-routes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const API_DIR = path.join(ROOT, "app", "api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

/** Routes whose handler cannot run in a unit test, with the reason. Every entry is a route the
 *  net does NOT cover, so the list is asserted below to stay short. */
const UNPROBEABLE: Record<string, string> = {};

/** Handlers that answer a caller with no cookie on purpose, as "METHOD route". Anything else
 *  answering 2xx to an anonymous caller fails the anonymous test. */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  "POST login/route.ts": "the sign-in form posts here before any session exists",
  "POST logout/route.ts": "clearing a cookie needs no session; idempotent",
  "DELETE admin/impersonate/route.ts": "ends a Login-As; with no saved owner session it only clears both cookies",
};

/** Reads that DO hand org A's owner org B's rows today, as "METHOD route". Empty since the four
 *  the first run of this test found (groups, impersonatable, stock, commission) were fixed on
 *  2026-10-22. The list is a ratchet in both directions: a new leak fails the test, and so does
 *  fixing one without deleting its line here. */
const KNOWN_LEAKS: Record<string, string> = {};

const MARK = "LEAKMARK_B";

interface RouteInfo {
  file: string;
  rel: string;
  /** URL with each [segment] kept as {name} for substitution. */
  template: string;
  params: string[];
}

function discover(): RouteInfo[] {
  const out: RouteInfo[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") {
        const rel = path.relative(API_DIR, p).split(path.sep).join("/");
        const params: string[] = [];
        const segs = path
          .dirname(rel)
          .split("/")
          .filter((s) => s !== ".")
          .map((s) => {
            const m = s.match(/^\[+(?:\.\.\.)?(\w+)\]+$/);
            if (m) {
              params.push(m[1]);
              return `{${m[1]}}`;
            }
            return s;
          });
        out.push({ file: p, rel, template: "/api/" + segs.join("/"), params });
      }
    }
  };
  walk(API_DIR);
  return out.sort((x, y) => x.rel.localeCompare(y.rel));
}

const routes = discover();

type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
const modules = new Map<string, Partial<Record<Method, Handler>>>();
const importFailures: string[] = [];

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
let candidateIds: string[] = [];
let aOwnerCookie = "";

/** Every table that carries organization_id, fingerprinted for org 2 only. */
function fingerprintOrgB(): string {
  const db = getDb();
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((t) => t.name)
    .filter((name) => (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).some((c) => c.name === "organization_id"));
  const h = createHash("sha256");
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM "${t}" WHERE organization_id = 2 ORDER BY rowid`).all();
    h.update(t).update(JSON.stringify(rows));
  }
  /* Child tables (product_prices, packagings, order_lines, ...) carry no organization_id of their
     own: they belong to a company through a parent row. Fingerprint the rows hanging off company B's. */
  const orgTableSet = new Set(tables);
  const children = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((t) => t.name)
    .filter((name) => !orgTableSet.has(name));
  for (const t of children) {
    const fks = (db.prepare(`PRAGMA foreign_key_list("${t}")`).all() as { from: string; table: string; to: string | null }[]).filter(
      (fk) => orgTableSet.has(fk.table) && (fk.to === "id" || fk.to === null)
    );
    for (const fk of fks) {
      const rows = db.prepare(`SELECT * FROM "${t}" WHERE "${fk.from}" IN (SELECT id FROM "${fk.table}" WHERE organization_id = 2) ORDER BY rowid`).all();
      h.update(`${t}.${fk.from}`).update(JSON.stringify(rows));
    }
  }
  return h.digest("hex");
}

function markB(db: ReturnType<typeof getDb>) {
  /* Text columns the fixture fills for org 2. Appending (not replacing) keeps every UNIQUE and
     CHECK intact. A statement that no longer matches a column fails loudly, which is the point. */
  const targets: [string, string][] = [
    ["customers", "business_name"],
    ["products", "name"],
    ["users", "display_name"],
    ["groups", "name"],
    ["facilities", "name"],
    ["tasks", "title"],
    ["alerts", "title"],
    ["rules", "name"],
    ["vehicles", "name"],
    ["route_templates", "name"],
    ["objection_cards", "title_fa"],
    ["kpi_definitions", "title_fa"],
    ["reason_codes", "label_fa"],
    ["churn_scores", "reason_fa"],
  ];
  for (const [table, col] of targets) {
    const n = db.prepare(`UPDATE "${table}" SET "${col}" = "${col}" || ' ${MARK}' WHERE organization_id = 2`).run().changes;
    if (!n) throw new Error(`fixture has no org-2 row in ${table}.${col} to mark`);
  }
}

/** The text around the marker, so a failure says WHAT of B's came back, not only where. */
function around(text: string): string {
  const i = text.indexOf(MARK);
  return text.slice(Math.max(0, i - 70), i + MARK.length).replace(/\s+/g, " ");
}

/** Bodies a write is tried with. An empty body usually dies at validation before the handler looks
 *  anything up, which is how a missing organisation check on a PATCH went unseen: the net sent
 *  `{}`, got a 400, and never reached the UPDATE. The second body names the fields most handlers
 *  accept, so a handler that does not check the row's organisation actually writes. */
/** Foreign keys a body can name. Each is set to the candidate id under test, so a handler that
 *  attaches something to a row it was handed (a price to a product, an order to a customer)
 *  is tried with another company's row. */
const REFERENCE_FIELDS = [
  "product_id", "packaging_id", "customer_id", "order_id", "user_id", "group_id", "location_id", "facility_id",
  "supplier_id", "run_id", "stop_id", "batch_id", "vehicle_id", "driver_id", "seller_id", "entity_id", "payment_id",
  "cheque_id", "salesperson_user_id", "district_id", "list_id", "lead_id", "task_id", "plan_id",
];

const bodiesFor = (candidate: string, usedFields: string[]): Record<string, unknown>[] => {
  const id = Number(candidate);
  const filler = {
    entity_type: "customer", valid_from: "2026-01-01", planned_date: "2026-01-01", due_date: "2026-01-01",
    location_ids: [id], ids: [id], items: [{ product_id: id, qty: 1 }],
    name: "LEAK", display_name: "LEAK", title: "LEAK", label: "LEAK", note: "LEAK", notes: "LEAK", address: "LEAK",
    phone: "09120000000", active: false, status: "cancelled", color: "#2DE0E6", amount_toman: 1, price_toman: 1,
    quantity: 1, qty: 1, rate_per_kg_toman: 1, override_pct: 1, paid_on: "2026-01-01", run_date: "2026-01-01", packs: 1,
    kind: "sales", line: { product_id: id, packaging_id: id, packs: 1 }, lat: 35.7, lng: 51.4, role: "phone_sales", password: "leakleakleak1",
  };
  return [
    {},
    // Every reference at once, then each one the handler actually reads on its own: a handler that
    // checks a second reference (a packaging of the product) would otherwise hide a missing check
    // on the first.
    { ...Object.fromEntries(REFERENCE_FIELDS.map((f) => [f, id])), ...filler },
    ...usedFields.map((f) => ({ [f]: id, ...filler })),
  ];
};

const usedCache = new Map<string, string[]>();
/** Reference fields a route's source mentions, so each can be tried on its own. */
function usedFieldsOf(r: RouteInfo): string[] {
  let used = usedCache.get(r.file);
  if (!used) {
    const src = fs.readFileSync(r.file, "utf8");
    used = REFERENCE_FIELDS.filter((f) => src.includes(f));
    usedCache.set(r.file, used);
  }
  return used;
}

function req(method: Method, url: string, cookie?: string, body: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const init: { method: Method; headers: Record<string, string>; body?: string } = { method, headers };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://localhost${url}`, init);
}

async function call(r: RouteInfo, method: Method, value: string, cookie?: string, body: Record<string, unknown> = {}): Promise<{ status: number; text: string } | null> {
  const handler = modules.get(r.rel)?.[method];
  if (!handler) return null;
  const params: Record<string, string> = {};
  let url = r.template;
  for (const p of r.params) {
    params[p] = value;
    url = url.replace(`{${p}}`, value);
  }
  try {
    const res = await handler(req(method, url, cookie, body), { params: Promise.resolve(params) });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    /* A handler that throws instead of answering is a 500 to the client. It is not a leak, so
       it is counted, not failed -- see the 5xx note in the summary test. */
    return { status: 599, text: String(e) };
  }
}

beforeAll(async () => {
  /* No handler may reach the network: push, Telegram, geocoding and map-link resolution all
     use fetch, and a hung socket would hang the suite. A refused fetch becomes a 5xx. */
  vi.stubGlobal("fetch", () => Promise.reject(new Error("network disabled in tenancy-routes test")));

  const db = getDb();
  ({ a, b } = seedTwoOrgs(db));
  /* The fixture ships owners and managers only. The commission and stock readers also walk
     sellers, drivers and field reps, so org B gets one of each (and A none: if A's owner sees
     them, they came from B). */
  for (const role of ["phone_sales", "delivery_driver", "field_rep"] as const) {
    const id = Number(
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
           VALUES (?, 'x:y', ?, ?, ?, 1, '2026-01-01T00:00:00.000Z', 2)`
        )
        .run(`b-${role}`, `${role} b`, role, b.groupId).lastInsertRowid
    );
    db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)").run(id, role);
  }
  /* Rows that can actually be changed or deleted: a group with no users (a group with members
     refuses deletion for a different reason) and a second facility (the last one is protected). */
  db.prepare("INSERT INTO groups (name, slug, color, active, created_at, organization_id) VALUES ('empty b', 'empty-b', '#2DE0E6', 1, '2026-01-01', 2)").run();
  db.prepare("INSERT INTO facilities (slug, kind, name, lat, lng, updated_at, organization_id, created_at) VALUES ('wh-b2', 'warehouse', 'second b', 35, 51, '2026-01-01', 2, '2026-01-01')").run();
  /* An ungrouped list: an owner reaches ungrouped rows by group alone, so only the company check keeps it out. */
  db.prepare("INSERT INTO lead_lists (name, group_id, created_at, updated_at, organization_id) VALUES ('b list', NULL, '2026-01-01', '2026-01-01', 2)").run();
  db.prepare("INSERT INTO saved_locations (name, maps_url, resolution, created_at, group_id, organization_id) VALUES ('b pin', 'https://maps.example/b-ungrouped', 'manual', '2026-01-01', NULL, 2)").run();
  markB(db);
  aOwnerCookie = `${COOKIE_NAME}=${createSessionToken({ uid: a.ownerId, role: "owner", gid: null, oid: 1, tv: 0, name: "A" })}`;

  const bIds = Object.entries(b)
    .filter(([k, v]) => k !== "orgId" && typeof v === "number" && v > 0)
    .map(([, v]) => String(v));
  /* Plus the id of every company-B row in every tenant table, so a handler keyed on any of them is tried. */
  const orgTables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((t) => t.name)
    .filter((name) => {
      const cols = (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name);
      return cols.includes("organization_id") && cols.includes("id");
    });
  const rowIds = orgTables.flatMap((t) => (db.prepare(`SELECT id FROM "${t}" WHERE organization_id = 2 LIMIT 20`).all() as { id: number }[]).map((r) => String(r.id)));
  candidateIds = [...new Set([...bIds, ...rowIds, "999999"])];

  for (const r of routes) {
    if (UNPROBEABLE[r.rel]) continue;
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(r.file).href);
      const handlers: Partial<Record<Method, Handler>> = {};
      for (const m of METHODS) if (typeof mod[m] === "function") handlers[m] = mod[m];
      modules.set(r.rel, handlers);
    } catch (e) {
      importFailures.push(`${r.rel}: ${String(e).slice(0, 160)}`);
    }
  }
}, 300_000);

afterAll(() => {
  vi.unstubAllGlobals();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

describe("tenancy net over every api route", () => {
  it("finds and imports every route (an unimportable route is a hole in the net)", () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(importFailures).toEqual([]);
    expect(Object.keys(UNPROBEABLE).length).toBeLessThanOrEqual(5);
    const withHandlers = [...modules.values()].filter((h) => Object.keys(h).length > 0).length;
    expect(withHandlers).toBe(routes.length - Object.keys(UNPROBEABLE).length);
  });

  it("an owner of org A reading with org B's ids gets nothing of B's back", async () => {
    const leaks: string[] = [];
    const leaking = new Set<string>();
    for (const r of routes) {
      const values = r.params.length ? candidateIds : ["0"];
      for (const v of values) {
        const out = await call(r, "GET", v, aOwnerCookie);
        if (!out || !out.text.includes(MARK)) continue;
        if (KNOWN_LEAKS[`GET ${r.rel}`]) leaking.add(`GET ${r.rel}`);
        else leaks.push(`GET ${r.template.replace(/\{\w+\}/g, v)} (${out.status}) …${around(out.text)}`);
      }
    }
    expect(leaks).toEqual([]);
    // The ratchet's other direction: a fixed route must leave the list.
    expect(Object.keys(KNOWN_LEAKS).filter((k) => !leaking.has(k))).toEqual([]);
  }, 300_000);

  it("an owner of org A writing with org B's ids changes nothing of B's, and gets nothing of B's back", async () => {
    let before = fingerprintOrgB();
    const leaks: string[] = [];
    const touched: string[] = [];
    for (const r of routes) {
      for (const m of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        /* A route with no path id still takes ids in its body, so it is tried with every candidate too
           (its URL ignores the value); the empty body only needs one pass. */
        const values = r.params.length ? candidateIds : ["0", ...candidateIds];
        for (const v of values) {
          for (const body of bodiesFor(v, usedFieldsOf(r))) {
            if (!r.params.length && v !== "0" && Object.keys(body).length === 0) continue;
            const out = await call(r, m, v, aOwnerCookie, body);
            if (!out) continue;
            const at = `${m} ${r.template.replace(/\{\w+\}/g, v)} (${out.status})`;
            if (out.text.includes(MARK)) leaks.push(`${at} …${around(out.text)}`);
            const after = fingerprintOrgB();
            if (after !== before) {
              touched.push(`${at} with ${Object.keys(body).length ? "a full body" : "an empty body"}`);
              before = after; // keep going: report every route that writes, not only the first
            }
          }
        }
      }
    }
    expect({ leaks, touched }).toEqual({ leaks: [], touched: [] });
  }, 900_000);

  it("a caller with no cookie is refused by every route except the ones public by design", async () => {
    const open: string[] = [];
    for (const r of routes) {
      for (const m of METHODS) {
        if (PUBLIC_BY_DESIGN[`${m} ${r.rel}`]) continue;
        const out = await call(r, m, "1");
        if (out && out.status >= 200 && out.status < 300) open.push(`${m} ${r.template.replace(/\{\w+\}/g, "1")} (${out.status})`);
      }
    }
    expect(open).toEqual([]);
  }, 300_000);

  it("every PUBLIC_BY_DESIGN and KNOWN_LEAKS entry names a real handler", () => {
    for (const key of [...Object.keys(PUBLIC_BY_DESIGN), ...Object.keys(KNOWN_LEAKS)]) {
      const [m, rel] = key.split(" ") as [Method, string];
      expect(modules.get(rel)?.[m], key).toBeTypeOf("function");
    }
  });

  it("the fingerprint notices a change to org B (positive control for the write test)", () => {
    const before = fingerprintOrgB();
    getDb().prepare("UPDATE groups SET name = name || '!' WHERE organization_id = 2").run();
    expect(fingerprintOrgB()).not.toBe(before);
    getDb().prepare("UPDATE groups SET name = substr(name, 1, length(name) - 1) WHERE organization_id = 2").run();
    expect(fingerprintOrgB()).toBe(before);
  });
});
