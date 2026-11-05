import { getDb } from "@/lib/db";
import { isCompanyFx, type CompanyFx } from "@/lib/fx";

/** The company's switch for decorative effects, set by the owner for everyone in the company. */
export async function effectsFor(organizationId: number): Promise<CompanyFx> {
  const row = (await getDb().prepare("SELECT effects FROM organizations WHERE id = ?").get(organizationId)) as { effects: string } | undefined;
  return isCompanyFx(row?.effects) ? row.effects : "auto";
}

export async function setEffects(organizationId: number, effects: CompanyFx): Promise<void> {
  await getDb().prepare("UPDATE organizations SET effects = ? WHERE id = ?").run(effects, organizationId);
}
