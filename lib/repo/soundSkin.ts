import { getDb } from "@/lib/db";
import { DEFAULT_SKIN, isSkin, type Skin } from "@/lib/soundRecipes";

/** The company's sound skin (F117), chosen by the owner for everyone in the company. */
export async function soundSkinFor(organizationId: number): Promise<Skin> {
  const row = await getDb().prepare("SELECT sound_skin FROM organizations WHERE id = ?").get(organizationId) as { sound_skin: string } | undefined;
  return isSkin(row?.sound_skin) ? row.sound_skin : DEFAULT_SKIN;
}

export async function setSoundSkin(organizationId: number, skin: Skin): Promise<void> {
  await getDb().prepare("UPDATE organizations SET sound_skin = ? WHERE id = ?").run(skin, organizationId);
}
