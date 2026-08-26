import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** The sales section's own chrome.
 *
 *  Separate from the map's on purpose: this is used on a phone, one-handed, while
 *  standing in a shop, and the map's chrome assumes a map underneath it. Sharing a layout
 *  would mean every future change to one had to be checked against the other.
 *
 *  proxy.ts has already refused a driver by the time this renders -- the redirect below
 *  is the belt to its braces, because a coarse gate on a cookie is not an authorisation
 *  decision and this layout wraps pages that will read real figures.
 */
export default async function SalesLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const tabs = [
    { href: "/sales", label: "خلاصه" },
    { href: "/sales/orders", label: "سفارش‌ها" },
    { href: "/sales/products", label: "کالاها و قیمت‌ها" },
  ];

  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-[var(--space-4)] py-[var(--space-5)]">
      <header className="mb-[var(--space-5)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="m-0 text-[length:var(--text-lg)] font-medium text-[var(--text)]">
            فروش و سفارش‌ها
          </h1>
          <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {session.user.display_name} · {ROLE_LABEL[session.role]}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)] no-underline transition-colors duration-[var(--dur-base)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          ← نقشه
        </Link>
      </header>

      <nav className="mb-[var(--space-5)] flex flex-wrap gap-[var(--space-2)]">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)] no-underline transition-colors duration-[var(--dur-base)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
