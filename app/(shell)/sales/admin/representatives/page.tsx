import { redirect } from "next/navigation";

/** Merged into /sales/reps (item 25): defining a representative and watching how they
 *  perform are one subject at two stages, and the two pages had collided into the nav as
 *  «تعریف نمایندگی» and «نمایندگان فروش». The definition screen is now that page's
 *  «تعریف و راه‌اندازی» mode. Kept as a redirect so old links and bookmarks still land. */
export default function AdminRepresentativesRedirect() {
  redirect("/sales/reps?view=define");
}
