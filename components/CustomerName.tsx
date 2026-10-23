import Link from "next/link";

/** A customer's name that opens the customer. Wherever a list shows who a payment, a
 *  complaint or an order belongs to, tapping the name should lead to that customer rather
 *  than leave the reader to search for them.
 *
 *  /crm/[id] is open to every shell role (appNav: «مشتریان و سرنخ‌ها» is ready for all of
 *  them); van roles never see these lists, so no role check is needed here. */
export default function CustomerName({ id, name }: { id: number | null | undefined; name: string }) {
  if (!id) return <>{name}</>;
  return (
    <Link href={`/crm/${id}`} className="text-[var(--text)] underline-offset-2 hover:text-[var(--accent)] hover:underline">
      {name}
    </Link>
  );
}
