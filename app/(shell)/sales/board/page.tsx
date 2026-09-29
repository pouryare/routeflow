import { redirect } from "next/navigation";

/** /sales/board is now the «تابلو» view of /sales/orders.
 *
 *  A redirect, not a deletion: the board is one of the three ways to read one table, and
 *  a bookmark, a shared link or a manager's muscle memory all still point here. A 404
 *  would be a worse answer than the extra hop.
 *
 *  The view travels WITH the redirect. /sales/board → a bare /sales/orders would show the
 *  pocket list, which is not what the person who clicked expected — a consolidation that
 *  changes what a link means is not a consolidation. */
export default function BoardPage() {
  redirect("/sales/orders?view=board");
}
