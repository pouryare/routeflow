import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { activeGroup, appTabs } from "@/lib/appNav";
import { pageMetaFor } from "@/lib/pageMeta";
import { faJalaliLong } from "@/lib/jalali";
import PageHeaderCard from "@/components/meridian/PageHeaderCard";

/** The server half of the page-overview card: it knows the session, so it knows which
 *  sibling tabs this reader may actually reach.
 *
 *  `route` is passed explicitly because a server component cannot read the pathname, and
 *  guessing it from headers would be a worse kind of magic — one line per page, and the
 *  route it names is the one pageMeta is keyed on, so a typo fails the page's own copy
 *  lookup immediately.
 *
 *  Async. Rendered from a page that is itself a server component, that costs nothing —
 *  loading.tsx covers a page's own awaits.
 *
 *  Rendered from a LAYOUT — which seven client-component routes must do, since a client
 *  file cannot import this — it MUST be wrapped in that layout's own <Suspense>. Per
 *  Next's layout.js docs, loading.tsx sits below layout.tsx and cannot cover a layout's
 *  await, so an unwrapped one blocks every navigation into the route and silently
 *  disables loading.tsx. tests/shell-pages-have-tabs.test.ts holds both rules.
 */
export default async function PageHeader({ route }: { route: string }) {
  /* Computed here on the server and passed down, so the client card cannot hydrate a
     different day. It used to sit under the wordmark the header no longer has. */
  const date = faJalaliLong(new Date().toISOString());
  const meta = pageMetaFor(route);
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);

  if (!session) {
    /* The signed-out card still gets its help: "what is this screen" does not require a
       login, and the reader who most needs it is the one who has not signed in yet. */
    return (
      <PageHeaderCard title={meta.title} overview={meta.overview} help={meta.help} date={date} />
    );
  }

  const all = appTabs(session);
  const group = activeGroup(route, all);
  const siblings = all.filter((t) => t.group === group && t.ready);
  const current = all
    .filter((t) => t.ready && (route === t.href || route.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  /* One sibling is not a section — a lone tab in the bay reads as a stray chip. And a
     route that is none of the tabs (/settings/notifications) shows none: activeGroup
     falls back to the first group so the header pill always has one, but printing that
     group's tabs here dressed the settings page up as a sales page. */
  return (
    <PageHeaderCard
      title={meta.title}
      overview={meta.overview}
      help={meta.help}
      date={date}
      tabs={current && siblings.length > 1 ? siblings : []}
      currentHref={current}
    />
  );
}
