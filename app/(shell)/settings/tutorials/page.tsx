import { cookies } from "next/headers";
import PageHeader from "@/components/meridian/PageHeader";
import TutorialList from "@/components/tutorials/TutorialList";
import TutorSection from "@/components/tutorials/TutorSection";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { assignmentsSentBy, stepCounts, tutorialPeople } from "@/lib/repo/tutorials";
import { TUTOR_ROLES } from "@/lib/tutorials/catalog";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/settings/tutorials");

/** «آموزش برنامه»: every tutorial this person's role has, the «چطور…؟» search, replay and practice.
 *  Managers and owners also get «فرستادن آموزش» (idea I7) and the owner the company's counts (idea I12).
 *  Reached from the account menu (accountLinks) and the driver's links. */
export default async function TutorialsPage() {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  const tutor = !!session && TUTOR_ROLES.includes(session.role);
  const org = session?.organizationId ?? 0;
  const [people, sent, counts] = tutor
    ? await Promise.all([
        tutorialPeople(org, session.user.id),
        assignmentsSentBy(org, session.user.id),
        OWNER_ROLES.includes(session.role) ? stepCounts(org) : Promise.resolve(null),
      ])
    : [[], [], null];
  return (
    <>
      <PageHeader route="/settings/tutorials" />
      <TutorialList />
      {tutor ? <TutorSection people={people} sent={sent} counts={counts} /> : null}
    </>
  );
}
