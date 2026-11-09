import { getDb } from "@/lib/db";
import { isCompanyFx, type CompanyFx } from "@/lib/fx";
import { DEFAULT_SKIN, isSkin, type Skin } from "@/lib/soundRecipes";

/** The company's look and sound, set by the owner for everyone in the company: the switch for
 *  decorative effects and the sound skin (F117). One read, since every screen asks for both. */
export async function companyLookFor(organizationId: number): Promise<{ effects: CompanyFx; soundSkin: Skin }> {
  const row = (await getDb().prepare("SELECT effects, sound_skin FROM organizations WHERE id = ?").get(organizationId)) as
    | { effects: string; sound_skin: string }
    | undefined;
  return {
    effects: isCompanyFx(row?.effects) ? row.effects : "auto",
    soundSkin: isSkin(row?.sound_skin) ? row.sound_skin : DEFAULT_SKIN,
  };
}

export async function setEffects(organizationId: number, effects: CompanyFx): Promise<void> {
  await getDb().prepare("UPDATE organizations SET effects = ? WHERE id = ?").run(effects, organizationId);
}
