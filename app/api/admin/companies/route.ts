import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { isUniqueViolation } from "@/lib/database/errors";
import { normalizeHostname } from "@/lib/companyHost";
import { createCompany, listCompanies } from "@/lib/repo/companies";
import { mainAddressOwnerOnly, serverIp } from "@/lib/repo/companyDomains";
import { arvanConfigured } from "@/lib/arvan";
import { MIN_PASSWORD, parseLogo, USERNAME_RE } from "@/lib/companyInput";

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/** Platform owner only: the companies, their addresses, and the platform switches around them. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  return await withDbScope("all", async () =>
    NextResponse.json({ ok: true, companies: await listCompanies(), main_owner_only: await mainAddressOwnerOnly(), arvan: { configured: arvanConfigured(), server_ip: await serverIp() } })
  );
}

/** A new company in one step: name, optional logo and address, and its first owner login. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return bad("درخواست نامعتبر است");

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 80) return bad("نام شرکت الزامی است و حداکثر ۸۰ نویسه");
  const rawHost = typeof b.hostname === "string" ? b.hostname.trim() : "";
  const hostname = rawHost ? normalizeHostname(rawHost) : null;
  if (rawHost && !hostname) return bad("نشانی نامعتبر است؛ مثلاً app.example.ir");
  const logo = parseLogo(b.logo);
  if (logo && "error" in logo) return bad(logo.error);
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const displayName = typeof b.display_name === "string" ? b.display_name.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!USERNAME_RE.test(username)) return bad("نام کاربری باید ۳ تا ۴۰ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد");
  if (!displayName || displayName.length > 80) return bad("نام نمایشی مدیر الزامی است و حداکثر ۸۰ نویسه");
  if (password.length < MIN_PASSWORD) return bad(`رمز عبور باید حداقل ${MIN_PASSWORD} نویسه باشد`);

  try {
    const id = await withDbScope("all", () =>
      createCompany({ name, hostname, logo, owner: { username, displayName, password } })
    );
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return bad("این نام کاربری یا این نشانی قبلاً ثبت شده است", 409);
    throw e;
  }
}
