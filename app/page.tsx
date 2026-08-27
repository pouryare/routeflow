import { redirect } from "next/navigation";

/** The sales section is the app's front door.
 *
 *  A redirect rather than a copy of /sales here: the sales pages share a layout that
 *  provides the chrome, the tab pill and the session guard, and rendering them from two
 *  routes would mean two places to keep in step. The map now lives at /map.
 */
export default function Home() {
  redirect("/sales");
}
