import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `avatar-patch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { NextRequest } = await import("next/server");
const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

let owner = 0;
let manager = 0;
let driver = 0;
let org = 0;
let group = 0;

/** The claims lib/auth.ts actually signs. Anything else fails the MAC check, and a 401
 *  for a malformed cookie would make this whole file pass for the wrong reason. `tv` must
 *  equal users.token_version, which the schema defaults to 0. */
const tokenFor = (uid: number, role: "owner" | "group_manager" | "delivery_driver") =>
  createSessionToken({ uid, role, gid: null, oid: org, tv: 0, name: "t" });

function req(token: string, body: unknown, id = driver): InstanceType<typeof NextRequest> {
  return new NextRequest(`http://localhost/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${token}` },
    body: JSON.stringify(body),
  });
}

const avatarOf = async (id: number) =>
  (await getDb().prepare("SELECT avatar_url FROM users WHERE id = ?").get(id) as {
    avatar_url: string | null;
  }).avatar_url;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  org = Number(
    (await db
      .prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)")
      .run("Avatars Inc", `avatars-${Date.now()}`, now)).lastInsertRowid,
  );
  // The route refuses to edit a non-owner who has no group (route.ts:117), so the driver
  // needs one. Without it every assertion here would be measuring THAT 400, not this task.
  group = Number(
    (await db
      .prepare("INSERT INTO groups (name, slug, active, created_at) VALUES (?, ?, 1, ?)")
      .run("گروه", `g-${Date.now()}`, now)).lastInsertRowid,
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,organization_id,created_at) VALUES (?,?,?,?,?,?,?)",
  );
  owner = Number((await u.run(`o${Date.now()}`, "x", "مالک", "owner", null, org, now)).lastInsertRowid);
  manager = Number((await u.run(`m${Date.now()}`, "x", "مدیر", "group_manager", group, org, now)).lastInsertRowid);
  driver = Number((await u.run(`d${Date.now()}`, "x", "راننده", "delivery_driver", group, org, now)).lastInsertRowid);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("avatar_url on the admin user PATCH", () => {
  it("an owner can set an avatar", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(owner, "owner");
    const res = await PATCH(req(token, { avatar_url: "/api/users/7/avatar" }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(200);
    expect(await avatarOf(driver)).toBe("/api/users/7/avatar");
  });

  it("a NON-owner is refused", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(manager, "group_manager");
    const res = await PATCH(req(token, { avatar_url: "/api/users/9/avatar" }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(403);
  });

  it("an empty string clears the photo, and clearing is not the same as failing", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(owner, "owner");
    expect(await avatarOf(driver)).toBe("/api/users/7/avatar");
    const res = await PATCH(req(token, { avatar_url: "" }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(200);
    expect(await avatarOf(driver)).toBeNull();
  });

  it("a preset key is allowed", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(owner, "owner");
    const res = await PATCH(req(token, { avatar_url: "/api/users/7/avatar?key=chef-2" }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(200);
    expect(await avatarOf(driver)).toBe("/api/users/7/avatar?key=chef-2");
  });

  /**
   * This column is rendered as an <img src> on every page that shows a person, so an
   * arbitrary URL would make every reader's browser fetch a third party on login, and a
   * `javascript:` value would turn the admin screen into an XSS sink. The door is the
   * cheap place to refuse it.
   */
  it.each([
    ["https://evil.example/pixel.png", "an off-site URL"],
    ["javascript:alert(1)", "a javascript: URL"],
    ["//evil.example/p.png", "a protocol-relative URL"],
    ["/api/users/abc/avatar", "a non-numeric id"],
    ["/uploads/../../etc/passwd", "a traversal"],
  ])("refuses %s (%s)", async (bad) => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const token = tokenFor(owner, "owner");
    const res = await PATCH(req(token, { avatar_url: bad }), {
      params: Promise.resolve({ id: String(driver) }),
    } as never);
    expect(res.status).toBe(400);
    // and the refused value must not have been written
    expect(await avatarOf(driver)).toBe("/api/users/7/avatar?key=chef-2");
  });
});

/** The avatar directory is redirected to a tmp path BEFORE lib/avatarStore is imported,
 *  so these tests never write a real photograph into data/photos/. */
const avatarTmp = path.join(os.tmpdir(), `avatar-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.ROUTEFLOW_AVATAR_DIR = avatarTmp;

const sharp = (await import("sharp")).default;
const { ensureAvatarDir, AVATAR_PRESETS } = await import("@/lib/avatarStore");

describe("avatar upload and serve", () => {
  beforeAll(async () => {
    fs.mkdirSync(avatarTmp, { recursive: true });
    await ensureAvatarDir();
  });

  afterAll(() => fs.rmSync(avatarTmp, { recursive: true, force: true }));

  async function upload(token: string, userId: number, bytes: Buffer, type = "image/png") {
    const { POST } = await import("@/app/api/photos/avatar/route");
    const form = new FormData();
    form.append("file", new File([new Uint8Array(bytes)], "x", { type }));
    form.append("user_id", String(userId));
    return POST(
      new NextRequest("http://localhost/api/photos/avatar", {
        method: "POST",
        headers: { cookie: `${COOKIE_NAME}=${token}` },
        body: form,
      }),
    );
  }

  const solidPng = (size = 900) =>
    sharp({
      create: { width: size, height: size, channels: 3, background: { r: 20, g: 120, b: 200 } },
    }).png().toBuffer();

  it("an owner can upload and gets a URL back", async () => {
    const res = await upload(tokenFor(owner, "owner"), driver, await solidPng());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { avatar_url: string };
    expect(json.avatar_url).toBe(`/api/users/${driver}/avatar`);
    // and the row points at it in the same request — no window with bytes but no pointer
    expect(await avatarOf(driver)).toBe(`/api/users/${driver}/avatar`);
  });

  it("the uploaded avatar is servable, and re-encoded down to the avatar cap", async () => {
    const { GET } = await import("@/app/api/users/[id]/avatar/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/users/${driver}/avatar?format=webp`, {
        headers: { cookie: `${COOKIE_NAME}=${tokenFor(owner, "owner")}` },
      }),
      { params: Promise.resolve({ id: String(driver) }) } as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
    // 512 is the cap: a 900px upload must not be stored at 900
    const meta = await sharp(bytes).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(512);
  });

  it("a NON-owner cannot upload", async () => {
    const res = await upload(tokenFor(manager, "group_manager"), driver, Buffer.from([1, 2, 3]));
    expect(res.status).toBe(403);
  });

  it("refuses a non-image", async () => {
    const res = await upload(tokenFor(owner, "owner"), driver, Buffer.from("nope"), "text/plain");
    expect(res.status).toBe(400);
  });
it("refuses a file that lies about its type but is not decodable", async () => {
    // `startsWith("image/")` trusts the client's Content-Type. A .txt renamed .png passes
    // it, and only sharp can tell the truth — hence 422, not 400.
    const res = await upload(tokenFor(owner, "owner"), driver, Buffer.from("not a png at all"), "image/png");
    expect(res.status).toBe(422);
  });

  it("cannot upload for a user in another organisation", async () => {
    const now = new Date().toISOString();
    const otherOrg = Number(
      (await getDb().prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)")
        .run("Elsewhere", `else-${Date.now()}`, now)).lastInsertRowid,
    );
    const stranger = Number(
      (await getDb().prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,organization_id,created_at) VALUES (?,?,?,?,?,?,?)",
      ).run(`s${Date.now()}`, "x", "بیگانه", "delivery_driver", group, otherOrg, now)).lastInsertRowid,
    );
    const res = await upload(tokenFor(owner, "owner"), stranger, await solidPng(32));
    expect(res.status).toBe(404);
  });

  it("the serve route needs no elevated role — a driver may see a colleague", async () => {
    const { GET } = await import("@/app/api/users/[id]/avatar/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/users/${driver}/avatar?format=webp`, {
        headers: { cookie: `${COOKIE_NAME}=${tokenFor(driver, "delivery_driver")}` },
      }),
      { params: Promise.resolve({ id: String(driver) }) } as never,
    );
    // 200 if this user has a photo, 404 if not — what matters is that it is NOT 401/403.
    expect([200, 404]).toContain(res.status);
  });

  it("a preset is served to any authenticated caller, not just an owner", async () => {
    const { GET } = await import("@/app/api/users/[id]/avatar/route");
    // Seed the preset the way scripts/seed-avatars.mjs does, so this test does not depend
    // on data/photos/avatars/ having been seeded on whichever machine runs it.
    const key = AVATAR_PRESETS[0].key;
    const src = path.join(process.cwd(), "public", "avatars", `driver.${key}.jpg`);
    const { encodeImage, AVATAR_MAX_EDGE } = await import("@/lib/imagePipeline");
    const encoded = await encodeImage(fs.readFileSync(src), AVATAR_MAX_EDGE);
    fs.writeFileSync(path.join(avatarTmp, `${key}.webp`), encoded.webp);

    const res = await GET(
      new NextRequest(`http://localhost/api/users/${driver}/avatar?key=${key}`, {
        headers: { cookie: `${COOKIE_NAME}=${tokenFor(driver, "delivery_driver")}` },
      }),
      { params: Promise.resolve({ id: String(driver) }) } as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  it("the serve route refuses an unauthenticated caller", async () => {
    const { GET } = await import("@/app/api/users/[id]/avatar/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/users/${driver}/avatar`, { headers: {} }),
      { params: Promise.resolve({ id: String(driver) }) } as never,
    );
    expect(res.status).toBe(401);
  });

  it("an unknown preset key is a 404, not a traversal", async () => {
    const { GET } = await import("@/app/api/users/[id]/avatar/route");
    const res = await GET(
      new NextRequest(
        `http://localhost/api/users/${driver}/avatar?key=${encodeURIComponent("../../etc/passwd")}`,
        { headers: { cookie: `${COOKIE_NAME}=${tokenFor(owner, "owner")}` } },
      ),
      { params: Promise.resolve({ id: String(driver) }) } as never,
    );
    expect(res.status).toBe(404);
  });
});
