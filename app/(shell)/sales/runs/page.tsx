import { redirect } from "next/navigation";

/** /sales/runs is now the «سفرها» view of /sales/schedule.
 *
 *  A redirect, not a deletion: this is where a manager has typed the URL for years, and
 *  a 404 would be a worse answer than the extra hop. The view travels with it, because
 *  /sales/runs → a bare /sales/schedule would show the month, which is not what the
 *  person who clicked expected.
 *
 *  The page's own `phone_sales` guard moved with the planner, onto the host's
 *  `?view=runs` branch. proxy.ts's isBatchAdmin still names /sales/runs, so an API call
 *  there is still bounced for the same roles; only the page is gone. */
export default function RunsPage() {
  redirect("/sales/schedule?view=runs");
}
