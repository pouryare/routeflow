import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import RatingTagsSettings from "@/components/settings/RatingTagsSettings";
import { ratingTagsFor } from "@/lib/repo/ratingTags";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/admin/rating-tags");

export const dynamic = "force-dynamic";

/** The company's rating tags for lead visits, for the owner (the admin layout gates it). */
export default async function RatingTagsPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const tags = await ratingTagsFor(session.organizationId);
  return (
    <>
      <PageHeader route="/sales/admin/rating-tags" />
      <RatingTagsSettings initial={tags} />
    </>
  );
}
