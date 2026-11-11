import { arvanSetup } from "@/lib/arvan";
import { checkDomain } from "@/lib/domainCheck";
import { setDomainStatus } from "@/lib/repo/companies";
import { serverIp } from "@/lib/repo/companyDomains";

/** Does the Arvan side of one address (domain added, A record to our server, HTTPS) and records how far it got.
 *  Never throws: a failure is stored on the address as «خطا» with the reason. Runs inside withDbScope("all"). */
export async function setupAddress(d: { id: number; hostname: string; arvan_cname: string | null }): Promise<{ ok: boolean; error: string | null }> {
  try {
    const ip = await serverIp();
    if (!ip) throw new Error("اول نشانی IP سرور را در صفحهٔ شرکت‌ها بنویسید");
    const state = await arvanSetup(d.hostname, ip);
    const r = await checkDomain(d.hostname, d.arvan_cname, state);
    await setDomainStatus(d.id, r.status, r.error);
    return { ok: true, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : "تنظیم در آروان انجام نشد";
    await setDomainStatus(d.id, "failed", error);
    return { ok: false, error };
  }
}
