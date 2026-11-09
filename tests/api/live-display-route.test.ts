import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";

process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");
// Its own database: the hub keeps a LISTEN connection open, which would stop another file
// sharing the default key from recreating that database.
process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-live-display-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");
const live = await import("@/lib/repo/live");
const { liveHub } = await import("@/lib/live/hub");
const keysRoute = await import("@/app/api/live/display-keys/route");
const oneKey = await import("@/app/api/live/display-keys/[id]/route");
const stream = await import("@/app/api/live/route");

const ORG = 43;
let owner = 0;
let seller = 0;

const req = (url: string, uid: number, role: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: ORG, tv: 0, name: "t" })}` },
  });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

/** Reads a stream until `done` says so or a second passes; returns what it got. */
async function read(res: Response, done: (text: string) => boolean): Promise<string> {
  const r = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  const end = Date.now() + 1500;
  while (Date.now() < end && !done(text)) {
    const next = await Promise.race([r.read(), new Promise<null>((ok) => setTimeout(() => ok(null), 100))]);
    if (next && !next.done) text += dec.decode(next.value);
    if (next?.done) break;
  }
  await r.cancel().catch(() => undefined);
  return text;
}

beforeAll(async () => {
  const db = getDb();
  await db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'پخش', 'pakhsh43', '2026-01-01')").run(ORG);
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,organization_id,active,token_version,created_at) VALUES (?,?,?,?,?,1,0,'2026-01-01')");
  owner = Number((await u.run("o43", "x:y", "مالک", "owner", ORG)).lastInsertRowid);
  seller = Number((await u.run("s43", "x:y", "فروشنده", "phone_sales", ORG)).lastInsertRowid);
});
afterAll(async () => {
  await liveHub.stop();
});

describe("display links for the live stream (L9)", () => {
  it("only an owner makes them, and the key is shown once", async () => {
    expect((await keysRoute.POST(req("/api/live/display-keys", seller, "phone_sales", "POST", { label: "TV", topics: ["runs"] }))).status).toBe(403);
    expect((await keysRoute.POST(req("/api/live/display-keys", owner, "owner", "POST", { label: "", topics: ["runs"] }))).status).toBe(400);
    expect((await keysRoute.POST(req("/api/live/display-keys", owner, "owner", "POST", { label: "TV", topics: ["DROP TABLE"] }))).status).toBe(400);
    const made = await keysRoute.POST(req("/api/live/display-keys", owner, "owner", "POST", { label: "تلویزیون انبار", topics: ["runs"] }));
    expect(made.status).toBe(201);
    const body = await made.json();
    expect(body.key).toMatch(new RegExp(`^${ORG}\\.`));
    const list = await (await keysRoute.GET(req("/api/live/display-keys", owner, "owner"))).json();
    expect(list.keys[0]).toMatchObject({ label: "تلویزیون انبار", topics: ["runs"], revoked_at: null });
    expect(JSON.stringify(list)).not.toContain(body.key);
  });

  it("opens the stream with nobody signed in, for its topics only, until it is revoked", async () => {
    const { id, key } = await (await keysRoute.POST(req("/api/live/display-keys", owner, "owner", "POST", { label: "TV", topics: ["runs"] }))).json();
    const res = await stream.GET(new NextRequest(`http://localhost/api/live?display=${encodeURIComponent(key)}`));
    expect(res.status).toBe(200);
    const runs = await live.publishLive(ORG, { topic: "runs", data: { id: 5 } });
    await live.publishLive(ORG, { topic: "orders", data: { id: 6 } }); // not this screen's topic
    await live.publishLive(ORG, { topic: "runs", users: [seller] }); // aimed at a person: never to a screen
    const text = await read(res, (t) => t.includes(`id: ${runs}\n`));
    expect(text).toContain(`id: ${runs}\n`);
    expect(text).not.toContain('"t":"orders"');
    expect(text.match(/"t":"runs"/g)).toHaveLength(1);
    expect(await live.onlineUserIds(ORG)).toEqual([]); // a screen is not a person online

    const again = await stream.GET(new NextRequest(`http://localhost/api/live?display=${encodeURIComponent(key)}`));
    expect((await oneKey.DELETE(req(`/api/live/display-keys/${id}`, owner, "owner", "DELETE"), ctx(id))).status).toBe(200);
    expect(await read(again, (t) => t.includes("live.bye"))).toContain("live.bye");
    expect((await stream.GET(new NextRequest(`http://localhost/api/live?display=${encodeURIComponent(key)}`))).status).toBe(401);
    expect((await stream.GET(new NextRequest("http://localhost/api/live?display=43.nonsense"))).status).toBe(401);
  });
});
