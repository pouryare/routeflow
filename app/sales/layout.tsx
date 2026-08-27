import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import ThemeToggle from "@/components/ThemeToggle";
import TabPill from "@/components/kargah/TabPill";

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

  // `ready` flips as each slice lands. A tab for a page that does not exist yet is not
  // merely untidy: Next prefetches every <Link> on render, so it 404s in the console
  // before anyone touches it, and 404s under the reader who does.
  const tabs = [
    { href: "/sales", label: "خلاصه", ready: true },
    { href: "/sales/dashboard", label: "داشبورد", ready: true },
    { href: "/sales/products", label: "کالاها و قیمت‌ها", ready: true },
    { href: "/sales/orders", label: "سفارش‌ها", ready: true },
    { href: "/sales/runs", label: "مسیر تحویل", ready: session.role !== "salesperson" },
    { href: "/sales/commission", label: "پورسانت", ready: true },
    { href: "/sales/stock", label: "انبار و خرید", ready: true },
  ];

  return (
    /* `kargah` is the scope the whole design system hangs off. Every token in
       MASTER.md's Color table is defined on this class rather than on :root, because
       the map and the other CRM surfaces still read the original palette. */
    <div className="kargah min-h-screen">
      <div className="mx-auto w-full max-w-[1240px] px-[var(--space-4)] py-[var(--space-5)] pb-[var(--space-12)]">
        <header className="mb-[var(--space-5)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
          <div className="flex min-w-0 items-center gap-[var(--space-3)]">
            <span
              aria-hidden="true"
              className="grid h-[46px] w-[46px] flex-none place-items-center rounded-[var(--radius-lg)] bg-[var(--accent)] text-[length:var(--text-lg)] font-semibold text-[var(--accent-ink)]"
              style={{ boxShadow: "0 6px 16px -6px color-mix(in srgb, var(--accent) 55%, transparent)" }}
            >
              ف
            </span>
            <div className="min-w-0">
              <h1 className="m-0 text-[length:var(--text-xl)] font-semibold tracking-[-0.015em] text-[var(--text)]">
                فروش و سفارش‌ها
              </h1>
              <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                {session.user.display_name} · {ROLE_LABEL[session.role]}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-[var(--space-2)]">
            <ThemeToggle />
            <Link
              href="/"
              className="rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)] no-underline shadow-[var(--sh-1)] transition-[box-shadow,transform] duration-[var(--dur-base)] hover:-translate-y-px hover:text-[var(--text)] hover:shadow-[var(--sh-2)]"
            >
              ↗ نقشه
            </Link>
          </div>
        </header>

        <div className="mb-[var(--space-5)]">
          <TabPill tabs={tabs} />
        </div>

        {children}
      </div>
    </div>
  );
}
