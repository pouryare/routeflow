import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The server command (deploy/routeflow) is bash. These source it and call its helpers inside a
 *  throwaway ROUTEFLOW_ROOT, so nothing touches systemd, the database or /opt. */
const SCRIPT = path.join(process.cwd(), "deploy", "routeflow");

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "rf-cli-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function run(snippet: string): { code: number; out: string; err: string } {
  const r = spawnSync("bash", ["-c", `. "${SCRIPT}"; ${snippet}`], {
    env: { ...process.env, ROUTEFLOW_ROOT: root },
    encoding: "utf8",
  });
  return { code: r.status ?? -1, out: r.stdout.trim(), err: r.stderr.trim() };
}

const HOST_ARCH = os.arch() === "arm64" ? "arm64" : "x64";

/** A minimal release tarball with its .sha256, in the layout scripts/release/pack.sh writes. */
function fakeTarball(version: string, arch = HOST_ARCH): string {
  const name = `routeflow-${version}-linux-${arch}`;
  const dir = path.join(root, "build", name);
  fs.mkdirSync(path.join(dir, "node", "bin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node", "bin", "node"), "#!/bin/sh\n", { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "server.js"), "");
  fs.writeFileSync(path.join(dir, "VERSION"), `${version}\n`);
  fs.writeFileSync(path.join(dir, "data", "tehran-districts.json"), "{}");
  const tarball = path.join(root, "incoming", `${name}.tar.gz`);
  fs.mkdirSync(path.dirname(tarball), { recursive: true });
  execFileSync("tar", ["-czf", tarball, "-C", path.join(root, "build"), name]);
  const sum = execFileSync("sha256sum", [tarball], { encoding: "utf8" }).split(" ")[0];
  fs.writeFileSync(`${tarball}.sha256`, `${sum}  ${path.basename(tarball)}\n`);
  return tarball;
}

function release(version: string, ageMinutes: number) {
  const dir = path.join(root, "releases", version);
  fs.mkdirSync(dir, { recursive: true });
  const t = new Date(Date.now() - ageMinutes * 60_000);
  fs.utimesSync(dir, t, t);
}

describe("routeflow: machine type and tarball names", () => {
  it("maps uname -m to the tarball's machine type", () => {
    expect(run("machine_arch x86_64").out).toBe("x64");
    expect(run("machine_arch aarch64").out).toBe("arm64");
    expect(run("machine_arch armv7l").code).not.toBe(0);
  });

  it("reads the version and type from a tarball name and refuses anything else", () => {
    expect(run("parse_tarball_name /x/routeflow-0.2.10-linux-arm64.tar.gz").out).toBe("0.2.10 arm64");
    expect(run("parse_tarball_name routeflow-0.2-linux-x64.tar.gz").code).not.toBe(0);
    expect(run("parse_tarball_name 'routeflow-0.2.0-linux-x64.tar.gz;rm'").code).not.toBe(0);
  });
});

describe("routeflow: unpacking a release", () => {
  it("checks the sum, unpacks to releases/<version> and links the shared photo and map folders", () => {
    const t = fakeTarball("0.1.0");
    const r = run(`unpack_release "${t}"`);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe("0.1.0");
    const rel = path.join(root, "releases", "0.1.0");
    expect(fs.readlinkSync(path.join(rel, "data", "photos"))).toBe(path.join(root, "data", "photos"));
    expect(fs.readlinkSync(path.join(rel, "data", "map"))).toBe(path.join(root, "data", "map"));
    expect(fs.existsSync(path.join(rel, "data", "tehran-districts.json"))).toBe(true);
  });

  it("refuses a tarball whose sum does not match, and leaves nothing behind", () => {
    const t = fakeTarball("0.1.0");
    fs.writeFileSync(`${t}.sha256`, `${"0".repeat(64)}  x\n`);
    expect(run(`unpack_release "${t}"`).code).not.toBe(0);
    expect(fs.existsSync(path.join(root, "releases", "0.1.0"))).toBe(false);
  });

  it("refuses a tarball built for the other machine type", () => {
    const t = fakeTarball("0.1.0", HOST_ARCH === "x64" ? "arm64" : "x64");
    const r = run(`unpack_release "${t}"`);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("this machine is");
  });
});

describe("routeflow: choosing releases", () => {
  it("keeps the live release and the two newest others", () => {
    release("0.1.0", 50);
    release("0.2.0", 40);
    release("0.3.0", 30);
    release("0.4.0", 20);
    release("0.5.0", 10);
    fs.symlinkSync("releases/0.3.0", path.join(root, "current"));
    expect(run("prune_releases").code).toBe(0);
    expect(fs.readdirSync(path.join(root, "releases")).sort()).toEqual(["0.3.0", "0.4.0", "0.5.0"]);
  });

  it("rolls back to the newest release that is not live", () => {
    release("0.1.0", 30);
    release("0.2.0", 20);
    release("0.3.0", 10);
    fs.symlinkSync("releases/0.3.0", path.join(root, "current"));
    expect(run("previous_release").out).toBe("0.2.0");
  });

  it("picks the highest waiting version for the nightly upgrade, comparing numbers not text", () => {
    fakeTarball("0.9.0");
    fakeTarball("0.10.0");
    expect(path.basename(run("newest_incoming").out)).toBe(`routeflow-0.10.0-linux-${HOST_ARCH}.tar.gz`);
  });
});

describe("routeflow: when switching back is safe", () => {
  it("is safe only when every new migration is marked expand-only", () => {
    const mig = path.join(root, "rel", "db", "migrations");
    fs.mkdirSync(mig, { recursive: true });
    fs.writeFileSync(path.join(mig, "1_add.sql"), "-- Up Migration\n-- rf: expand-only\nALTER TABLE a ADD COLUMN b int;\n");
    fs.writeFileSync(path.join(mig, "2_drop.sql"), "-- Up Migration\n-- rf: contract\nALTER TABLE a DROP COLUMN c;\n");
    const rel = path.join(root, "rel");
    expect(run(`all_expand_only "${rel}" 1_add`).code).toBe(0);
    expect(run(`all_expand_only "${rel}" 1_add 2_drop`).code).not.toBe(0);
  });
});

describe("routeflow: secrets stay out of the plain env file", () => {
  it("knows which keys are secrets", () => {
    for (const k of ["DATABASE_URL", "SESSION_SECRET", "TELEGRAM_BOT_TOKEN", "SMOKE_PASSWORD", "FARAZSMS_APIKEY", "S3_SECRET_KEY"]) {
      expect(run(`is_secret_key ${k}`).code, k).toBe(0);
    }
    for (const k of ["PG_SCOPED", "ROUTEFLOW_PHOTOS_DIR", "COVERAGE_BACKUP_DIR", "KEYBOARD"]) {
      expect(run(`is_secret_key ${k}`).code, k).not.toBe(0);
    }
  });

  it("splits an env file into plain and secret lines", () => {
    const env = path.join(root, "env");
    fs.writeFileSync(env, "# note\nDATABASE_URL=postgres://u:p@/db?host=/run\nPG_SCOPED=1\nSESSION_SECRET=abc=\n");
    expect(run(`split_env "${env}" "${root}/plain" "${root}/secret"`).code).toBe(0);
    expect(fs.readFileSync(path.join(root, "plain"), "utf8")).toBe("# note\nPG_SCOPED=1\n");
    expect(fs.readFileSync(path.join(root, "secret"), "utf8")).toBe("DATABASE_URL=postgres://u:p@/db?host=/run\nSESSION_SECRET=abc=\n");
  });

  it("merges two secret lists with the second one winning, one line per key", () => {
    fs.writeFileSync(path.join(root, "a"), "SESSION_SECRET=new\nX_TOKEN=1\n");
    fs.writeFileSync(path.join(root, "b"), "SESSION_SECRET=kept=x\nY_KEY=2\n");
    const lines = run(`merge_env "${root}/a" "${root}/b"`).out.split("\n").sort();
    expect(lines).toEqual(["SESSION_SECRET=kept=x", "X_TOKEN=1", "Y_KEY=2"]);
  });
});
