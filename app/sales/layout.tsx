import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { faJalaliLong } from "@/lib/jalali";
import SkinToggle from "@/components/kargah/SkinToggle";
import AccentPicker from "@/components/AccentPicker";
import TabPill from "@/components/kargah/TabPill";
import RevealRoute from "@/components/kargah/RevealRoute";
import SyncStatus from "@/components/SyncStatus";

export const dynamic = "force-dynamic";

/** The sales section's chrome, laid out exactly as the approved artifact draws it:
 *  gradient mark, title with the date beneath, the map chip, the sun/moon toggle, and
 *  the viewer's initial — then the travelling tab pill.
 *
 *  proxy.ts has already refused a driver by the time this renders -- the redirect below
 *  is the belt to its braces, because a coarse gate on a cookie is not an authorisation
 *  decision and this layout wraps pages that read real figures.
 */
export default async function SalesLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  // `ready` flips as each slice lands. A tab for a page that does not exist yet is not
  // merely untidy: Next prefetches every <Link> on render, so it 404s in the console
  // before anyone touches it, and 404s under the reader who does.
  const tabs = [
    { href: "/sales", label: "داشبورد", ready: true },
    { href: "/sales/dashboard", label: "تحلیل و KPI", ready: true },
    { href: "/sales/orders", label: "سفارش‌ها", ready: true },
    { href: "/sales/board", label: "تخصیص کارها", ready: true },
    { href: "/sales/journey", label: "مسیر سفارش", ready: true },
    { href: "/sales/schedule", label: "برنامهٔ روز", ready: true },
    { href: "/sales/products", label: "کالاها و قیمت‌ها", ready: true },
    { href: "/sales/runs", label: "مسیر تحویل", ready: session.role !== "salesperson" },
    { href: "/sales/commission", label: "پورسانت", ready: true },
    { href: "/sales/payments", label: "دریافت‌ها", ready: true },
    { href: "/sales/cheques", label: "چک‌ها", ready: session.role === "owner" || session.role === "group_manager" },
    { href: "/sales/stock", label: "انبار و خرید", ready: true },
    { href: "/sales/batches", label: "بچ‌ها", ready: session.role === "owner" || session.role === "group_manager" },
    { href: "/sales/deliveries", label: "تحویل‌ها", ready: session.role === "owner" || session.role === "group_manager" },
    { href: "/sales/routing", label: "مسیریابی", ready: session.role === "owner" || session.role === "group_manager" },
    { href: "/sales/complaints", label: "شکایات", ready: true },
    // Owner only: the proxy refuses everyone else, so a tab for them would 404 on click.
    { href: "/sales/admin/users", label: "کاربران", ready: session.role === "owner" },
    { href: "/sales/admin/groups", label: "گروه‌ها", ready: session.role === "owner" },
    {
      href: "/sales/admin/representatives",
      label: "نمایندگان",
      ready: session.role === "owner" || session.role === "rep_manager",
    },
  ];

  const initial = session.user.display_name.trim()[0] ?? "؟";

  return (
    /* `kargah` is the scope the whole design system hangs off. Every token the artifact
       names is defined on this class -- see app/globals.css, "کارگاه". */
    <div className="kargah min-h-screen">
      <div className="app">
        <div className="top">
          <div className="brandwrap">
            <div className="mark">ف</div>
            <div>
              <h1>فروش و سفارش‌ها</h1>
              <div className="sub">{faJalaliLong(new Date().toISOString())}</div>
            </div>
          </div>
          <div className="topright">
            <Link className="chip" href="/map">↗ نقشه</Link>
            <SkinToggle />
            <AccentPicker />
            <div className="me" title={`${session.user.display_name} · ${ROLE_LABEL[session.role]}`}>
              {initial}
            </div>
          </div>
        </div>

        <TabPill tabs={tabs} />

        {/* One entrance for every sales screen — see RevealRoute for why it is not
            wired per page. */}
        <RevealRoute />
        {children}
      </div>
      <SyncStatus />
    </div>
  );
}
