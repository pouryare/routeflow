import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { isVanRole } from "@/lib/roles";
import { doorSaleEntry } from "@/lib/repo/doorSale";
import { orderEntryFor } from "@/lib/repo/ordersView";
import PageHeader from "@/components/meridian/PageHeader";
import DoorSaleScreen from "@/components/driver/DoorSaleScreen";
import StatePage from "@/components/meridian/StatePage";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/door-sale");

export const dynamic = "force-dynamic";

/** فروش در محل (VC4): sell from the van's own stock, or give a free sample, with the customer standing there.
 *  Only the van roles reach it; the sale is the ordinary order chain run in one go (lib/repo/doorSale.ts). */
export default async function DoorSalePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!isVanRole(session.role)) redirect("/");

  const entry = await doorSaleEntry(session.organizationId, session.user.id);
  if (!entry.hasVan) {
    return (
      <StatePage
        icon="truck"
        eyebrow="فروش در محل"
        title="ماشینی برای شما ثبت نشده است"
        hint="مدیر باید شما را راننده یک ماشین کند و کالا را روی آن بارگیری کند. بعد از آن فروش در محل اینجا کار می‌کند."
      />
    );
  }

  const { customers } = await orderEntryFor(session);
  const asked = (await searchParams).customer;
  const wanted = typeof asked === "string" && /^\d+$/.test(asked) ? Number(asked) : null;
  // A link is user input: a shop outside the person's reach does not preselect anything.
  const preset = wanted !== null && customers.some((c) => c.id === wanted) ? wanted : null;

  return (
    <>
      <PageHeader route="/sales/door-sale" />
      <DoorSaleScreen
        customers={customers.map((c) => ({ id: c.id, customer_code: c.customer_code, business_name: c.business_name, debt: c.debt, credit_limit_toman: c.credit_limit_toman }))}
        items={entry.items.map((i) => ({
          id: i.packaging_id,
          parent: i.product_id,
          label: i.label,
          qty: 0,
          max: i.packs_on_van,
          unit: "بسته",
          price: i.price_toman ?? undefined,
          packs_on_van: i.packs_on_van,
        }))}
        today={entry.today}
        presetCustomerId={preset}
      />
    </>
  );
}
