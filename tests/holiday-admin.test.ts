import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `holiday-admin-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { NextRequest } = await import("next/server");
const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { listHolidaysForMonth } = await import("@/lib/repo/holidays");
const { toJalali } = await import("@/lib/jalali");

let owner = 0;
let manager = 0;
let org = 0;

/** The claims lib/auth.ts actually signs: { uid, role, gid, oid, tv, name }.
 *  The plan's draft used `{ userId, role }`, which fails the MAC check and makes every
 *  test 401 — measuring auth instead of the thing under test. Same trap as the avatar
 *  routes; `tv` must equal users.token_version, which defaults to 0. */
const tokenFor = (uid: number, role: "owner" | "group_manager") =>
  createSessionToken({ uid, role, gid: null, oid: org, tv: 0, name: "t" });

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  org = Number(
    db
      .prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)")
      .run("H", `h-${Date.now()}`, now).lastInsertRowid,
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,organization_id,created_at) VALUES (?,?,?,?,?,?)",
  );
  owner = Number(u.run(`o${Date.now()}`, "x", "مالک", "owner", org, now).lastInsertRowid);
  manager = Number(u.run(`m${Date.now()}`, "x", "مدیر", "group_manager", org, now).lastInsertRowid);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const post = (token: string, body: unknown) =>
  new NextRequest("http://localhost/api/admin/holidays", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${token}` },
    body: JSON.stringify(body),
  });

const del = (token: string, iso: string) =>
  new NextRequest(`http://localhost/api/admin/holidays/${encodeURIComponent(iso)}`, {
    method: "DELETE",
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  });

describe("the holiday admin API", () => {
  it("an owner records a lunar holiday", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    const res = await POST(post(tokenFor(owner, "owner"), { iso: "2026-03-20", title_fa: "عید فطر", kind: "official" }));
    expect(res.status).toBe(200);
    const j = toJalali("2026-03-20")!;
    expect(listHolidaysForMonth(j.jy, j.jm).find((h) => h.iso === "2026-03-20")).toMatchObject({
      title_fa: "عید فطر",
      kind: "official",
    });
  });

  it("a NON-owner is refused", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    const res = await POST(post(tokenFor(manager, "group_manager"), { iso: "2026-03-21", title_fa: "x" }));
    expect(res.status).toBe(403);
  });

  it("refuses a blank title and a date that is not a real ISO date", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    const token = tokenFor(owner, "owner");
    for (const bad of [
      { iso: "2026-03-20", title_fa: "   " },
      { iso: "20-03-2026", title_fa: "x" },
      { iso: "2026-13-01", title_fa: "x" },
      { iso: "2026-02-30", title_fa: "x" },
      { iso: "", title_fa: "x" },
      {},
    ]) {
      expect((await POST(post(token, bad))).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("GET returns the stored rows", async () => {
    const { GET } = await import("@/app/api/admin/holidays/route");
    const res = await GET(
      new NextRequest("http://localhost/api/admin/holidays", {
        headers: { cookie: `${COOKIE_NAME}=${tokenFor(owner, "owner")}` },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { holidays: unknown[] };
    expect(Array.isArray(json.holidays)).toBe(true);
    expect(json.holidays.length).toBeGreaterThan(0);
  });

  it("GET is refused to a NON-owner too — a holiday list is still admin data", async () => {
    const { GET } = await import("@/app/api/admin/holidays/route");
    const res = await GET(
      new NextRequest("http://localhost/api/admin/holidays", {
        headers: { cookie: `${COOKIE_NAME}=${tokenFor(manager, "group_manager")}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("an unauthenticated caller gets 401 on both verbs", async () => {
    const { GET, POST } = await import("@/app/api/admin/holidays/route");
    const anon = new NextRequest("http://localhost/api/admin/holidays");
    expect((await GET(anon)).status).toBe(401);
    expect((await POST(post("", { iso: "2026-03-20", title_fa: "x" }))).status).toBe(401);
  });

  it("a recorded holiday is marked lunar, so the screen can say it needs confirming", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    await POST(post(tokenFor(owner, "owner"), { iso: "2026-05-27", title_fa: "عید قربان" }));
    const row = getDb().prepare("SELECT is_lunar FROM holidays WHERE iso_date = ?").get("2026-05-27") as {
      is_lunar: number;
    };
    expect(row.is_lunar).toBe(1);
  });

  it("re-recording the same date corrects it rather than duplicating", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    const token = tokenFor(owner, "owner");
    await POST(post(token, { iso: "2026-05-27", title_fa: "عید قربان (اشتباه)" }));
    await POST(post(token, { iso: "2026-05-27", title_fa: "عید قربان" }));
    const rows = getDb().prepare("SELECT title_fa FROM holidays WHERE iso_date = ?").all("2026-05-27");
    expect(rows).toHaveLength(1);
    expect((rows[0] as { title_fa: string }).title_fa).toBe("عید قربان");
  });

  it("an unknown kind falls back to official rather than writing junk", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    await POST(post(tokenFor(owner, "owner"), { iso: "2026-06-01", title_fa: "تست", kind: "invented" }));
    const row = getDb().prepare("SELECT kind FROM holidays WHERE iso_date = ?").get("2026-06-01") as {
      kind: string;
    };
    expect(row.kind).toBe("official");
  });

  it("a commemorative kind is stored as commemorative", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    await POST(post(tokenFor(owner, "owner"), { iso: "2026-06-02", title_fa: "یادبود", kind: "commemorative" }));
    const row = getDb().prepare("SELECT kind FROM holidays WHERE iso_date = ?").get("2026-06-02") as {
      kind: string;
    };
    expect(row.kind).toBe("commemorative");
  });

  it("a whitespace-only title is refused, and nothing is written", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    const res = await POST(post(tokenFor(owner, "owner"), { iso: "2026-06-03", title_fa: "\t\n  " }));
    expect(res.status).toBe(400);
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM holidays WHERE iso_date = ?").get("2026-06-03") as { n: number };
    expect(n.n).toBe(0);
  });

  it("refuses a title carrying an Arabic letter or a presentation form", async () => {
    // This text lands on a calendar grid, in the app whose own audit-copy bans both.
    const { POST } = await import("@/app/api/admin/holidays/route");
    const token = tokenFor(owner, "owner");
    await POST(post(token, { iso: "2026-06-04", title_fa: "عید فطر" }));
    // Built from CODEPOINTS, never typed: these glyphs are indistinguishable on screen, and
    // a hand-typed "obviously Arabic" literal is how I ended up asserting that perfectly
    // clean Persian was dirty. U+0643 ARABIC KAF is the real defect in the vendored
    // dataset's "عسکری"; U+0649 ARABIC YEH and U+0651 SHADDA are the other two classes
    // audit-copy flags.
    const ARABIC_KAF = String.fromCodePoint(0x0643);
    const ARABIC_YEH = String.fromCodePoint(0x0649);
    const SHADDA = String.fromCodePoint(0x0651);
    const bad = [
      `عس${ARABIC_KAF}ري`, // Arabic kaf where Persian needs U+06A9
      `ع${ARABIC_YEH}د`, // Arabic yeh
      `صل${SHADDA}ى`, // stray tashkeel on a Persian word
      "\uFED3\uFEAA\uFEAE", // presentation forms
    ];
    for (const title of bad) {
      const res = await POST(post(token, { iso: "2026-06-04", title_fa: title }));
      expect(res.status, `rejected: ${JSON.stringify(title)}`).toBe(400);
    }
  });

  it("DELETE removes a stored holiday", async () => {
    const { POST } = await import("@/app/api/admin/holidays/route");
    const { DELETE } = await import("@/app/api/admin/holidays/[iso]/route");
    const token = tokenFor(owner, "owner");
    await POST(post(token, { iso: "2026-06-05", title_fa: "موقتی" }));
    const res = await DELETE(del(token, "2026-06-05"), {
      params: Promise.resolve({ iso: "2026-06-05" }),
    } as never);
    expect(res.status).toBe(200);
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM holidays WHERE iso_date = ?").get("2026-06-05") as { n: number };
    expect(n.n).toBe(0);
  });

  it("DELETE on a malformed date is a 400, not a wildcard delete", async () => {
    const { DELETE } = await import("@/app/api/admin/holidays/[iso]/route");
    const res = await DELETE(del(tokenFor(owner, "owner"), ".."), {
      params: Promise.resolve({ iso: ".." }),
    } as never);
    expect(res.status).toBe(400);
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM holidays").get() as { n: number };
    expect(n.n).toBeGreaterThan(0);
  });

  it("DELETE is refused to a NON-owner and to an anonymous caller", async () => {
    const { DELETE } = await import("@/app/api/admin/holidays/[iso]/route");
    const ctx = { params: Promise.resolve({ iso: "2026-03-20" }) } as never;
    expect((await DELETE(del(tokenFor(manager, "group_manager"), "2026-03-20"), ctx)).status).toBe(403);
    expect(
      (await DELETE(new NextRequest("http://localhost/api/admin/holidays/2026-03-20", { method: "DELETE" }), ctx)).status,
    ).toBe(401);
  });

  it("DELETE of a date nothing stored still succeeds — idempotent", async () => {
    const { DELETE } = await import("@/app/api/admin/holidays/[iso]/route");
    const res = await DELETE(del(tokenFor(owner, "owner"), "1999-01-01"), {
      params: Promise.resolve({ iso: "1999-01-01" }),
    } as never);
    expect(res.status).toBe(200);
  });

  it("GET orders rows by date so the screen reads as a calendar", async () => {
    const { GET } = await import("@/app/api/admin/holidays/route");
    const res = await GET(
      new NextRequest("http://localhost/api/admin/holidays", {
        headers: { cookie: `${COOKIE_NAME}=${tokenFor(owner, "owner")}` },
      }),
    );
    const json = (await res.json()) as { holidays: Array<{ iso_date: string }> };
    const isos = json.holidays.map((h) => h.iso_date);
    expect(isos).toEqual([...isos].sort());
  });
});
