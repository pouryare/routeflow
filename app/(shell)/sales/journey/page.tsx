import { redirect } from "next/navigation";

/** /sales/journey is now the «پیگیری» view of /sales/orders.
 *
 *  A redirect, for the reason board/page.tsx gives. The old page's own `?view=one|all`
 *  switch did NOT survive: a deep link into the funnel arrives at the spine instead, and
 *  the mode picker is one click away. Carrying it would mean reading searchParams and
 *  rebuilding the query string, which is not worth the surface for a link nobody has
 *  bookmarked. Named here rather than hidden. */
export default function JourneyPage() {
  redirect("/sales/orders?view=journey");
}
