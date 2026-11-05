import PageHeader from "@/components/meridian/PageHeader";
import TutorialList from "@/components/tutorials/TutorialList";

/** «آموزش برنامه»: every tutorial this person's role has, the «چطور…؟» search, replay and practice.
 *  Reached from the account menu (accountLinks) and the driver's links. Signed-out visitors never
 *  get here (proxy.ts); the list itself reads the role from the tutorial provider. */
export default function TutorialsPage() {
  return (
    <>
      <PageHeader route="/settings/tutorials" />
      <TutorialList />
    </>
  );
}
