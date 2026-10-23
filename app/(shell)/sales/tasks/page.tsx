import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";

import { boardFor } from "@/lib/repo/board";
import { getPrefs } from "@/lib/repo/prefs";
import Board from "@/components/board/Board";
import type { BoardView } from "@/lib/tasks/lenses";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

/** The manager task Board — one set of tasks, three synced lenses. proxy.ts has already
 *  refused a salesperson/driver; the redirect is the belt to its braces. */
export default async function TasksBoardPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!["owner", "group_manager", "rep_manager", "platform_owner"].includes(session.role)) {
    redirect("/sales");
  }

  const prefs = await getPrefs(session.user.id);
  const view: BoardView = prefs.board_default_view ?? "status";
  const board = await boardFor(session, { view });

  // boardFor returns fresh object literals (rowToCard rebuilds each row), so it already
  // crosses the server→client boundary cleanly — no plain() needed.
  return (
    <>
    <PageHeader route="/sales/tasks" />
    <Board
      initialBoard={board}
      initialView={view}
      mobileMode={prefs.board_mobile_mode ?? "pager"}
    />    </>
  );
}
