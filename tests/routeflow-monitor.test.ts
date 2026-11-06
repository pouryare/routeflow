import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** deploy/monitor/routeflow-monitor runs on the Pi. These source it, replace the network calls
 *  (health, Telegram, SMS) with stubs that log to files, and walk the clock with NOW. */
const SCRIPT = path.join(process.cwd(), "deploy", "monitor", "routeflow-monitor");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-mon-"));
  fs.writeFileSync(path.join(dir, "conf"), `URL=https://app.test\nSUMMARY_HOUR=9\nBACKUP_DIR=${dir}/backups\n`);
  fs.mkdirSync(path.join(dir, "backups"));
  fs.writeFileSync(path.join(dir, "backups", "backup.info"), "x");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// 2026-11-05 03:00 Tehran (UTC+3:30) = 2026-11-04 23:30 UTC: before the summary hour.
const T0 = Date.UTC(2026, 10, 4, 23, 30) / 1000;

/** One tick at `now`, with health answering `ok`; telegram fails when `tgDown`. */
function tick(now: number, ok: boolean, tgDown = false, certDays = 90) {
  const stubs = `
    check_health() { HEALTH_OK=${ok ? 1 : 0}; HEALTH_VERSION=0.1.0; }
    telegram_send() { echo "$1" >> "${dir}/tg"; return ${tgDown ? 1 : 0}; }
    sms_send() { echo "$1" >> "${dir}/sms"; }
    disk_pct() { echo 10; }
    cert_days_left() { echo ${certDays}; }`;
  const r = spawnSync("bash", ["-c", `. "${SCRIPT}"; ${stubs}; NOW=${now} tick`], {
    env: { ...process.env, ROUTEFLOW_MONITOR_CONF: path.join(dir, "conf"), ROUTEFLOW_MONITOR_STATE: path.join(dir, "state") },
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
}
const sent = (f: "tg" | "sms") => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n") : []);
const freshBackup = (now: number) => fs.utimesSync(path.join(dir, "backups", "backup.info"), now - 3600, now - 3600);

describe("routeflow-monitor: outages", () => {
  it("ignores one failed check, alerts on the second, texts after 5 minutes, and says when it is back", () => {
    freshBackup(T0);
    tick(T0, false);
    expect(sent("tg")).toEqual([]);
    tick(T0 + 60, false);
    expect(sent("tg")).toHaveLength(1);
    expect(sent("tg")[0]).toContain("not answering");
    tick(T0 + 120, false);
    tick(T0 + 240, false);
    expect(sent("sms")).toEqual([]);
    tick(T0 + 300, false);
    expect(sent("sms")).toHaveLength(1);
    tick(T0 + 360, false);
    expect(sent("sms")).toHaveLength(1);
    tick(T0 + 420, true);
    expect(sent("tg")).toHaveLength(2);
    expect(sent("tg")[1]).toContain("back up after 7 min");
  });

  it("a blip that recovers sends nothing", () => {
    freshBackup(T0);
    tick(T0, false);
    tick(T0 + 60, true);
    expect(sent("tg")).toEqual([]);
  });

  it("texts at once when Telegram cannot be reached", () => {
    freshBackup(T0);
    tick(T0, false, true);
    tick(T0 + 60, false, true);
    expect(sent("sms")).toHaveLength(1);
    tick(T0 + 400, false, true);
    expect(sent("sms")).toHaveLength(1);
  });
});

describe("routeflow-monitor: backups, summary and the monthly test", () => {
  it("reports a backup older than 26 hours once, on both channels", () => {
    fs.utimesSync(path.join(dir, "backups", "backup.info"), T0 - 27 * 3600, T0 - 27 * 3600);
    tick(T0, true);
    tick(T0 + 60, true);
    expect(sent("tg").filter((m) => m.includes("backup"))).toHaveLength(1);
    expect(sent("sms")).toEqual(["RouteFlow backup is 27 hours old"]);
  });

  it("sends one daily summary after the summary hour", () => {
    freshBackup(T0);
    tick(T0, true);
    expect(sent("tg")).toEqual([]);
    const nine = T0 + 6 * 3600; // 09:00 Tehran
    freshBackup(nine);
    tick(nine, true);
    tick(nine + 60, true);
    expect(sent("tg")).toHaveLength(1);
    expect(sent("tg")[0]).toContain("version 0.1.0, 0 of 2 checks failed");
  });

  it("sends a test on both channels on the 1st of the month", () => {
    const first = Date.UTC(2026, 11, 1, 7, 0) / 1000; // 1 Dec 10:30 Tehran
    freshBackup(first);
    tick(first, true);
    tick(first + 60, true);
    expect(sent("tg").filter((m) => m.includes("test"))).toHaveLength(1);
    expect(sent("sms").filter((m) => m.includes("test"))).toHaveLength(1);
  });
});

describe("routeflow-monitor: certificate", () => {
  it("warns once a day when the certificate expires within 14 days", () => {
    freshBackup(T0);
    tick(T0, true, false, 10);
    tick(T0 + 60, true, false, 10);
    expect(sent("tg").filter((m) => m.includes("expires in 10 days"))).toHaveLength(1);
  });

  it("says nothing while the certificate has time left", () => {
    freshBackup(T0);
    tick(T0, true, false, 60);
    expect(sent("tg")).toEqual([]);
  });
});
