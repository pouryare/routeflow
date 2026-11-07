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
  it("checks the sum, unpacks to releases/<version> and links the shared photo, map, cache and held folders", () => {
    const t = fakeTarball("0.1.0");
    const r = run(`unpack_release "${t}"`);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe("0.1.0");
    const rel = path.join(root, "releases", "0.1.0");
    expect(fs.readlinkSync(path.join(rel, "data", "photos"))).toBe(path.join(root, "data", "photos"));
    expect(fs.readlinkSync(path.join(rel, "data", "map"))).toBe(path.join(root, "data", "map"));
    // The 7-day file cache and held uploads must outlive the release folder (lib/storage/cache.ts, files.ts).
    expect(fs.readlinkSync(path.join(rel, "data", "cache"))).toBe(path.join(root, "data", "cache"));
    expect(fs.readlinkSync(path.join(rel, "data", "held"))).toBe(path.join(root, "data", "held"));
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

describe("routeflow: a tarball still being copied", () => {
  it("is not picked until its .sha256 has arrived", () => {
    const t = fakeTarball("0.2.0");
    fs.rmSync(`${t}.sha256`);
    expect(run("newest_incoming").out).toBe("");
  });
});

describe("routeflow install: no questions with --yes", () => {
  it("takes the value from the environment or the default instead of asking", () => {
    expect(run('ROUTEFLOW_YES=1; DOMAIN=app.test; ask DOMAIN "q" ""; ask OWNER_USER "q" admin; echo "$DOMAIN $OWNER_USER"').out).toBe("app.test admin");
  });

  it("finds the tarball in incoming/ when none is named", () => {
    fakeTarball("0.3.0");
    expect(path.basename(run("install_tarball").out)).toBe(`routeflow-0.3.0-linux-${HOST_ARCH}.tar.gz`);
    expect(run("install_tarball /nope.tar.gz").code).not.toBe(0);
  });

  it("makes a 16-character password of unambiguous letters and digits", () => {
    const pw = run("new_password").out;
    expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
  });
});

describe("routeflow install: Pi pairing and checks", () => {
  it("prints commands for the Pi that add the backup key once and point the monitor at the domain", () => {
    const out = run('pi_pair_command "ssh-ed25519 AAAAkey routeflow-backup@vps" rfbackup /srv/rf app.test').out;
    expect(out).toContain('grep -qxF "ssh-ed25519 AAAAkey routeflow-backup@vps"');
    expect(out).toContain("install -d -o rfbackup -m 750 /srv/rf");
    expect(out).toContain("URL=https://app.test");
    // The Pi part is valid bash.
    const pi = out.split("\n").slice(0, 8).join("\n");
    expect(spawnSync("bash", ["-n"], { input: pi }).status).toBe(0);
  });

  it("refuses a domain that does not resolve", () => {
    const r = run("DOMAIN=nothing-here.invalid; preflight 2>/dev/null");
    expect(r.out).toContain("nothing-here.invalid does not resolve");
  });
});

describe("routeflow install: kernel settings", () => {
  it("keeps outgoing ports clear of the app and PostgreSQL, and keeps timestamps and retries", () => {
    const conf = run("write_sysctl").out;
    const start = Number(/ip_local_port_range = (\d+)/.exec(conf)?.[1]);
    expect(start).toBeGreaterThan(5432);
    expect(conf).toContain("tcp_congestion_control = bbr");
    expect(conf).not.toMatch(/tcp_timestamps|tcp_syn_retries|tcp_synack_retries|tcp_max_tw_buckets/);
  });
});

describe("routeflow: Arvan-only web ports and the certificate", () => {
  it("reads address ranges from Arvan's list and ignores anything else", () => {
    const r = run(`printf '185.143.232.0/22\\n<html>\\n2a0b:4d07::/32\\n\\n94.101.182.0/27 # x\\n' | parse_cdn_ips`);
    expect(r.out.split("\n")).toEqual(["185.143.232.0/22", "2a0b:4d07::/32", "94.101.182.0/27"]);
  });

  it("removes open-to-all web rules and ranges Arvan dropped, keeps SSH and current ranges", () => {
    const status = [
      "Status: active",
      "     To                         Action      From",
      "[ 1] OpenSSH                    ALLOW IN    Anywhere",
      "[ 2] 80/tcp                     ALLOW IN    Anywhere",
      "[ 3] 443/tcp                    ALLOW IN    Anywhere",
      "[ 4] 80,443/tcp                 ALLOW IN    185.143.232.0/22           # routeflow-cdn",
      "[ 5] 80,443/tcp                 ALLOW IN    10.9.9.0/24                # routeflow-cdn",
      "[ 6] 80/tcp (v6)                ALLOW IN    Anywhere (v6)",
    ].join("\n");
    fs.writeFileSync(path.join(root, "ufw"), status);
    const r = run(`stale_web_rules "185.143.232.0/22" < "${root}/ufw"`);
    expect(r.out.split("\n")).toEqual(["2", "3", "5"]);
  });

  it("uses an origin certificate when one is in place, Caddy's own when asked, else Let's Encrypt", () => {
    const conf = path.join(root, "etc");
    fs.mkdirSync(path.join(conf, "tls"), { recursive: true });
    const withConf = { ...process.env, ROUTEFLOW_CONF_DIR: conf };
    expect(spawnSync("bash", ["-c", `. "${SCRIPT}"; caddy_tls_line`], { encoding: "utf8", env: withConf }).stdout.trim()).toBe("");
    expect(spawnSync("bash", ["-c", `CERT_MODE=internal; . "${SCRIPT}"; caddy_tls_line`], { encoding: "utf8", env: withConf }).stdout.trim()).toBe("tls internal");
    fs.writeFileSync(path.join(conf, "tls", "origin.crt"), "x");
    fs.writeFileSync(path.join(conf, "tls", "origin.key"), "x");
    expect(spawnSync("bash", ["-c", `. "${SCRIPT}"; caddy_tls_line`], { encoding: "utf8", env: withConf }).stdout.trim()).toBe(
      `tls ${conf}/tls/origin.crt ${conf}/tls/origin.key`,
    );
  });
});

describe("routeflow: helper keys that expire", () => {
  it("turns 3d and 12h into an expiry time and refuses anything else", () => {
    expect(run("support_expiry 3d").out).toMatch(/^\d{12}$/);
    expect(run("support_expiry 12h").out).toMatch(/^\d{12}$/);
    expect(run("support_expiry 0d").code).not.toBe(0);
    expect(run("support_expiry soon").code).not.toBe(0);
  });

  it("removes only helper keys whose time has passed", () => {
    const keys = path.join(root, "authorized_keys");
    fs.writeFileSync(
      keys,
      [
        "ssh-ed25519 AAAAowner owner@laptop",
        'expiry-time="200001010000Z" ssh-ed25519 AAAAold helper routeflow-support',
        'expiry-time="299901010000Z" ssh-ed25519 AAAAnew helper routeflow-support',
      ].join("\n") + "\n",
    );
    const r = run(`SUPPORT_KEYS="${keys}"; support_prune`);
    expect(r.out).toBe("1");
    expect(fs.readFileSync(keys, "utf8")).toBe(
      'ssh-ed25519 AAAAowner owner@laptop\nexpiry-time="299901010000Z" ssh-ed25519 AAAAnew helper routeflow-support\n',
    );
  });
});

describe("routeflow: upgrade preview, maintenance and tidy-up", () => {
  it("lists the database changes a release would make and whether it can switch back", () => {
    const t = fakeTarball("0.2.0");
    // Rebuild the tarball with two migrations in it.
    const dir = path.join(root, "build", `routeflow-0.2.0-linux-${HOST_ARCH}`);
    fs.mkdirSync(path.join(dir, "db", "migrations"), { recursive: true });
    fs.writeFileSync(path.join(dir, "db", "migrations", "1_add.sql"), "-- Up Migration\n-- rf: expand-only\n");
    fs.writeFileSync(path.join(dir, "db", "migrations", "2_drop.sql"), "-- Up Migration\n-- rf: contract\n");
    execFileSync("tar", ["-czf", t, "-C", path.join(root, "build"), path.basename(dir)]);
    const sum = execFileSync("sha256sum", [t], { encoding: "utf8" }).split(" ")[0];
    fs.writeFileSync(`${t}.sha256`, `${sum}  ${path.basename(t)}\n`);
    // No database here: pending_migrations lists every file as pending.
    const r = run(`pending_migrations() { ls "$1/db/migrations" | sed 's/\\.sql$//'; }; cmd_upgrade_check "${t}"`);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("1_add   expand-only");
    expect(r.out).toContain("2_drop   contract");
    expect(r.out).toContain("waits for you");
  });

  it("anonymising SQL switches triggers off and covers phones, names and two-step secrets", () => {
    const sql = run("anonymise_sql").out;
    expect(sql).toContain("SET session_replication_role = replica");
    expect(sql).toMatch(/phone\|mobile/);
    expect(sql).toContain("business_name");
    expect(sql).toContain("totp_secret = NULL");
  });
});

describe("write_caddy: one file per site", () => {
  it("writes sites/routeflow.caddy, imports the folder once and moves an old import", () => {
    const caddy = path.join(root, "caddy");
    fs.mkdirSync(caddy);
    fs.writeFileSync(path.join(caddy, "Caddyfile"), "{\n\temail a@b.c\n}\nimport /etc/caddy/routeflow.caddy\n");
    fs.writeFileSync(path.join(caddy, "routeflow.caddy"), "old");
    const r = spawnSync(
      "bash",
      ["-c", `. "${SCRIPT}"; DOMAIN=app.test; APP_PORT=3003; caddy() { :; }; systemctl() { :; }; write_caddy; write_caddy`],
      { env: { ...process.env, ROUTEFLOW_ROOT: root, ROUTEFLOW_CADDY_DIR: caddy, ROUTEFLOW_CONF_DIR: path.join(root, "conf") }, encoding: "utf8" },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(caddy, "sites", "routeflow.caddy"), "utf8")).toContain("app.test {");
    const main = fs.readFileSync(path.join(caddy, "Caddyfile"), "utf8");
    expect(main.match(/import sites\/\*\.caddy/g)).toHaveLength(1);
    expect(main).not.toContain("routeflow.caddy");
    expect(main).toContain("email a@b.c");
    expect(fs.existsSync(path.join(caddy, "routeflow.caddy"))).toBe(false);
  });
});
