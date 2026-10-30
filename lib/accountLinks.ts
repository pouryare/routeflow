/** The "about this account" links: the avatar menu on a desk, «حساب من» in the phone's
 *  «بیشتر» sheet. One list so the two cannot disagree.
 *
 *  Every link here must open for the role it is shown to. The menu used to print the same
 *  four links for everyone: «ورود به‌عنوان…» to a salesperson, whom /switch sends back to
 *  /sales, and «نقشهٔ پوشش» to a driver, whom proxy.ts sends back to /driver. A link that
 *  answers with a redirect is a dead end the reader has to work out for themselves.
 *  tests/account-links.test.ts holds each link to the gate it would meet. */
import type { Role } from "./roles";
import { isOwner } from "./roles";
import { appTabs } from "./appNav";
import type { IconName } from "@/components/meridian/icon-map";

export type AccountLink = { href: string; label: string; icon: IconName };

export function accountLinks(session: { role: Role }): AccountLink[] {
  const canOpen = (href: string) => appTabs(session).some((t) => t.ready && t.href === href);
  const links: AccountLink[] = [];
  // /switch admits OWNER_ROLES only (switch/page.tsx); isOwner is that set.
  if (isOwner(session.role)) links.push({ href: "/switch", label: "ورود به‌عنوان…", icon: "repeat" });
  if (canOpen("/map")) links.push({ href: "/map", label: "نقشهٔ پوشش", icon: "map" });
  // /settings is open to every role, van roles included (proxy.ts allowlists it for them).
  links.push(
    { href: "/settings/notifications", label: "تنظیمات اعلان‌ها", icon: "bell" },
    { href: "/settings/security", label: "امنیت و ورود", icon: "settings" },
    { href: "/settings/sound", label: "صدا", icon: "volume" },
  );
  return links;
}
