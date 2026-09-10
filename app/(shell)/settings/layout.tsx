import type { ReactNode } from "react";
import Link from "next/link";

/** Per-user settings. Lives in the shell group because a driver owns their notification
 *  preferences too, and the shell's header is now the same one every themed route wears.
 *
 *  This used to render its own `meridian` scope, its own top bar and its own ProfileMenu.
 *  All three now come from app/(shell)/layout.tsx, so what is left is the section's own
 *  sub-nav and nothing else — a second copy of the chrome would render a second header.
 *
 *  Synchronous, like the shell above it: an `await cookies()` here would block every
 *  navigation into /settings/*. It previously redirected a session-less visitor to
 *  /login, which was already redundant twice over — proxy.ts refuses them before this
 *  renders, and settings/notifications/page.tsx re-checks the session itself.
 */
const NAV = [{ href: "/settings/notifications", label: "اعلان‌ها" }];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  /* One section is not a menu: a single link in its own 12rem column printed «اعلان‌ها»
     alone beside the page, pushing the content off-centre. The column returns when a
     second settings page does. */
  if (NAV.length < 2) return <main className="min-w-0">{children}</main>;
  return (
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
  );
}
