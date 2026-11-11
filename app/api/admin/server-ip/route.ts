import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { listCompanies } from "@/lib/repo/companies";
import { setPlatformSetting } from "@/lib/repo/companyDomains";
import { arvanConfigured, arvanPointAt } from "@/lib/arvan";

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** { ip }: saves the server's public address and moves every company address's A record in Arvan to it
 *  (the one-button answer to a new VPS). Reports the addresses that could not be moved. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { ip?: unknown } | null;
  const ip = typeof b?.ip === "string" ? b.ip.trim() : "";
  if (!IPV4.test(ip)) return NextResponse.json({ ok: false, error: "IP نامعتبر است؛ مثلاً 185.1.2.3" }, { status: 400 });
  return await withDbScope("all", async () => {
    await setPlatformSetting("server_ip", ip);
    const failed: string[] = [];
    let moved = 0;
    if (arvanConfigured()) {
      for (const c of await listCompanies()) {
        for (const d of c.domains) {
          try {
            await arvanPointAt(d.hostname, ip);
            moved++;
          } catch {
            failed.push(d.hostname);
          }
        }
      }
    }
    return NextResponse.json(
      failed.length ? { ok: false, error: `این نشانی‌ها در آروان عوض نشد: ${failed.join("، ")}` } : { ok: true, moved }
    );
  });
}
