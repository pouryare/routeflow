import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import ProfileMenu from "@/components/meridian/ProfileMenu";

export const dynamic = "force-dynamic";

/** Per-user settings, outside /sales because a driver owns their notification prefs too
 *  and /sales redirects drivers away. Deliberately thin: the same `meridian` scope and top
 *  bar as the sales chrome, then a nav list with room for more sections later. */
const NAV = [{ href: "/settings/notifications", label: "اعلان‌ها" }];

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");

  return (
    <div className="meridian min-h-screen">
      <div className="app">
        <div className="top">
          <div className="brandwrap">
            <div>
              <h1>تنظیمات</h1>
            </div>
          </div>
          <div className="topright">
            <ProfileMenu
              userId={session.user.id}
              name={session.user.display_name}
              roleLabel={ROLE_LABEL[session.role]}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-start">
          <nav aria-label="بخش‌های تنظیمات" className="shrink-0 md:w-48">
            <ul className="flex gap-2 md:flex-col">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link className="pm__link" href={n.href}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
