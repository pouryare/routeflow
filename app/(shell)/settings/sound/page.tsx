import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import SoundSettings from "@/components/settings/SoundSettings";
import EffectsSettings from "@/components/settings/EffectsSettings";
import { effectsFor } from "@/lib/repo/effects";
import { getPrefs } from "@/lib/repo/prefs";
import { soundSkinFor } from "@/lib/repo/soundSkin";
import { isOwner } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** F117: the app's sounds. Everyone switches their own on or off; the owner also picks how they
 *  sound for the whole company. */
export default async function SoundSettingsPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const [prefs, skin, company] = await Promise.all([getPrefs(session.user.id), soundSkinFor(session.organizationId), effectsFor(session.organizationId)]);

  return (
    <>
      <PageHeader route="/settings/sound" />
      <SoundSettings initialChoice={prefs.sound ?? null} initialSkin={skin} canPickSkin={isOwner(session.role)} />
      <div className="mt-[var(--space-4)]">
        <EffectsSettings initialPerson={prefs.effects ?? null} initialCompany={company} canSetCompany={isOwner(session.role)} />
      </div>
    </>
  );
}
