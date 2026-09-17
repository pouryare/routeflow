import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { profileFor, timelineFor } from "@/lib/repo/crm/profile";
import { idParam } from "@/lib/repo/crm/http";
import BusinessProfile from "@/components/crm/BusinessProfile";
import PageHeader from "@/components/meridian/PageHeader";
export const dynamic = "force-dynamic";
export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const id = idParam((await params).id);
  const profile = id === null ? null : profileFor(session, id);
  if (!profile || id === null) notFound();
  return <>
    <PageHeader route="/crm" />
    <BusinessProfile initial={profile} initialTimeline={timelineFor(session, id)!} />
  </>;
}
