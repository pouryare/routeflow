"use client";

import { Icon } from "@/components/meridian/Icon";
import Link from "next/link";
import CustomerBento, { useCustomerSummary } from "./CustomerBento";
import BottomSheet from "@/components/mobile/BottomSheet";
import { faDigits } from "@/lib/format";
import { useSession } from "@/lib/useSession";
import { actionsFor } from "@/lib/actionList";
import type { Role } from "@/lib/roles";

/** پنجرهٔ مشتری — the artifact's bottom bento sheet.
 *
 *  One component for both surfaces: the sales pockets open it, and so does the map. The
 *  alternative was a second copy on the map, which is how the map ended up with a
 *  customer panel that had drifted from the design in the first place.
 *
 *  Figures are fetched on open rather than shipped with the page: the orders list renders
 *  a hundred cards, and pre-loading a ninety-day summary for each would be a hundred
 *  aggregate queries for the one the reader might tap.
 */
export default function CustomerSheet({
  customerId,
  fallbackName,
  onClose,
}: {
  /** null closes the sheet. */
  customerId: number | null;
  /** Shown while the figures are still in flight, so the sheet opens with a title. */
  fallbackName?: string;
  onClose: () => void;
}) {
  const data = useCustomerSummary(customerId);
  const { role } = useSession();
  const failed = false;
  // T14: the buttons come from the shared action list, so a role never sees one that leads to a page it cannot open.
  const actions = role ? actionsFor(role as Role, "customer-record") : [];
  const button = (a: (typeof actions)[number], id: number) => (
    <Link key={a.id} className={`btn ${a.primary ? "solid" : "ghost"}`} style={{ minHeight: 44 }} href={a.href!([id])}><Icon name={a.icon} size="md" />{a.label}</Link>
  );

  const open = customerId !== null;

  return (
    <BottomSheet
      expandable
      open={open}
      title={data?.business_name ?? fallbackName ?? "مشتری"}
      subtitle={
        data
          ? [
              data.where,
              // The district code a rep can read out over the phone, right after the
              // place name it belongs to. faDigits because it is stored ASCII.
              data.district_code && faDigits(data.district_code),
              data.status,
              data.salesperson && `فروشنده: ${data.salesperson}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : failed
            ? "اطلاعات این مشتری خوانده نشد"
            : "در حال خواندن…"
      }
      onClose={onClose}
      closeLabel="بستن مشخصات"
      bodyClassName="customer-sheet"
    >
      <CustomerBento data={data} />
      {customerId !== null && <div style={{ padding: "16px 24px", display: "flex", flexWrap: "wrap", gap: 9 }}>
        {actions.map((a) => button(a, customerId))}
      </div>}
    </BottomSheet>
  );
}
