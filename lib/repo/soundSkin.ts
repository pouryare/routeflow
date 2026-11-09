import { getDb } from "@/lib/db";
import type { Skin } from "@/lib/soundRecipes";

/** Sets the company's sound skin (F117); companyLookFor in ./effects reads it. */
export async function setSoundSkin(organizationId: number, skin: Skin): Promise<void> {
  await getDb().prepare("UPDATE organizations SET sound_skin = ? WHERE id = ?").run(skin, organizationId);
}
