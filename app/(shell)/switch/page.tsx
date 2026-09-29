import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import AccountSwitcher from "@/components/meridian/AccountSwitcher";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

/** The account switcher as a full page — the same component the avatar menu links to.
 *
 *  Owner and platform_owner only. The gate is here as well as in proxy.ts because this
 *  page reads the session directly rather than trusting a middleware pass.
 *
 *  PageHeader (not a hand-written h1) because the house rule is that every shell page
 *  resolves its title and overview from pageMeta, and three tests enforce it. */
export default async function SwitchPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!OWNER_ROLES.includes(session.role)) redirect("/sales");

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader route="/switch" />
      <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
        هر کاری که اینجا انجام دهید به نام آن شخص ثبت می‌شود.
      </p>
      <AccountSwitcher variant="page" />
    </div>
  );
}
