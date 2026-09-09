import { permanentRedirect } from "next/navigation";

/** `/analytics` is retired. Its panels live at `/sales/dashboard` — the analytics page
 *  people actually use — under «پوشش و میدان».
 *
 *  This is a redirect router that renders nothing, so it sits outside both route groups
 *  the way `/` does: wrapping it in the shell would draw a header and a page-overview
 *  card for a page that is about to become a different page.
 *
 *  It is kept rather than deleted because the URL is in bookmarks, in the map's quick
 *  links as shipped, and in whatever anyone pasted into a chat. `permanentRedirect` (308)
 *  rather than a temporary one: this is not coming back.
 *
 *  proxy.ts still denies a فروشنده this path. That is deliberate belt-and-braces — the
 *  dashboard already skips the whole-group read for that role, so the redirect would be
 *  harmless, but the deny is one fewer thing to reason about.
 */
export default function AnalyticsRedirect(): never {
  permanentRedirect("/sales/dashboard");
}
