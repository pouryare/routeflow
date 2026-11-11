import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { listCompanies } from "@/lib/repo/companies";
import { arvanConfigured, arvanPurge, splitHost } from "@/lib/arvan";

/** Empties Arvan's cache for every company domain (after a deploy, so nobody sees old pages). */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  if (!arvanConfigured()) return NextResponse.json({ ok: false, error: "کلید آروان روی سرور تنظیم نشده است (ARVAN_API_KEY)" }, { status: 409 });
  const hosts = await withDbScope("all", async () => (await listCompanies()).flatMap((c) => c.domains.map((d) => d.hostname)));
  const roots = [...new Set(hosts.map((h) => splitHost(h).root))];
  const failed: string[] = [];
  for (const r of roots) await arvanPurge(r).catch(() => failed.push(r));
  return NextResponse.json(failed.length ? { ok: false, error: `پاک نشد: ${failed.join("، ")}` } : { ok: true, purged: roots.length });
}
