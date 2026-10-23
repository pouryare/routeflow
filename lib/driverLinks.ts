/** The way out of /driver to the driver's other places. /driver is a bare page (no header, no
 *  bottom bar, by design), and it used to have no link to the academy or to settings at all,
 *  though both are on a driver's allowlist: the notification opt-ins a driver needs for
 *  delivery.failed and task.assigned were reachable only by typing the address. */
import type { Role } from "./roles";
import { appTabs } from "./appNav";
import { accountLinks, type AccountLink } from "./accountLinks";
import { TAB_ICON } from "./mobileNav";

export function driverLinks(session: { role: Role }): AccountLink[] {
  const tabs = appTabs(session)
    .filter((t) => t.ready && t.href !== "/driver")
    .map((t) => ({ href: t.href, label: t.label, icon: TAB_ICON[t.href] ?? "arrow-left" }));
  const seen = new Set(tabs.map((t) => t.href));
  return [...tabs, ...accountLinks(session).filter((l) => !seen.has(l.href))];
}
