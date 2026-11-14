import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { catalogueFor } from "@/lib/repo/sessionReads";
import { vanFacilityFor } from "@/lib/repo/vanStock";
import { onHandByProduct } from "@/lib/repo/stock";
import { canSell, isVanRole } from "@/lib/roles";
import PageHeader from "@/components/meridian/PageHeader";
import CatalogueBrowser from "@/components/catalogue/CatalogueBrowser";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/catalogue");

export const dynamic = "force-dynamic";

/** The catalogue for the person standing at a customer's door (plan VC2, VC3b): search, groups, a card per
 *  product with its picture, packings, today's price and a line on how to say it. The page is cached by the
 *  service worker after a visit, so the last copy opens without a signal, and it says when its prices are from.
 *  What the goods cost us is never read here. */
export default async function CataloguePage() {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!canSell(session.role)) redirect("/");

  const products = await catalogueFor(session);
  // Approximate on purpose: the van's stock is what was loaded minus what was recorded delivered (F30 is not built).
  let onVan = new Map<number, number>();
  if (isVanRole(session.role)) {
    const van = await vanFacilityFor(session.organizationId, session.user.id);
    if (van !== null) onVan = await onHandByProduct(session.organizationId, van);
  }

  return (
    <>
      <PageHeader route="/sales/catalogue" />
      <CatalogueBrowser
        asOf={new Date().toISOString()}
        hasVan={isVanRole(session.role) && onVan.size > 0}
        items={products
          .filter((p) => p.packagings.length > 0)
          .map((p) => ({
            id: p.id,
            name: p.name,
            unit: p.base_unit,
            category: p.category ?? null,
            points: (p.selling_points ?? "").split("\n").filter(Boolean),
            say: p.how_to_say ?? null,
            imageId: p.image_id === null || p.image_id === undefined ? null : Number(p.image_id),
            onVan: onVan.has(p.id) ? Number(onVan.get(p.id)) : null,
            packs: p.packagings.map((k) => ({ id: k.id, name: k.name, price: k.price_toman })),
          }))}
      />
    </>
  );
}
