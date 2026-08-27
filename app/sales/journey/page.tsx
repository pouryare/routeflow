import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import { readJourney, buildJourney } from "@/lib/orderJourney";
import { faNum } from "@/lib/format";
import Reveal from "@/components/kargah/Reveal";
import OrderJourney from "@/components/sales/OrderJourney";

export const dynamic = "force-dynamic";

/** A query parameter may arrive repeated («?order=1&order=2»), in which case Next hands
 *  over an array. Taking the first beats letting `Number([..])` quietly produce NaN. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function JourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const scope = orderFilter(session);
  const orders = readOrders(db, scope, { limit: 60 });

  const asked = one((await searchParams).order);
  const wanted = asked !== undefined && /^\d+$/.test(asked) ? Number(asked) : undefined;
  /* Chosen from the list this session can already see, so the journey cannot be used to
     probe for an order in another group by its id -- the scope decision stays in
     orderFilter and is not re-derived here. */
  const focus = orders.find((o) => o.id === wanted) ?? orders[0];
  const journey = focus ? readJourney(db, focus.id) : null;

  return (
    <div className="block">
      <div className="bhead">
        <div>
          <h2>
            {focus ? `مسیر سفارش ${faNum(Number(focus.order_no.split("-")[1] ?? 0))} — ${focus.customer_name}` : "مسیر سفارش"}
          </h2>
          <div className="n">
            از ثبت تا تسویه · هر مرحله از روی همان چیزی خوانده می‌شود که ثبت شده
          </div>
        </div>
        {focus && (
          <div className="acts">
            <Link className="btn ghost" href={`/sales/orders/${focus.id}`}>
              صفحهٔ سفارش
            </Link>
          </div>
        )}
      </div>

      {focus && journey ? (
        <Reveal replayKey={focus.id} select=".lane2" className="lanes">
          <OrderJourney nodes={buildJourney(journey)} />
        </Reveal>
      ) : (
        <p style={{ padding: "0 24px 28px", color: "var(--muted)", fontSize: 13.5 }}>
          هنوز سفارشی برای نمایش مسیرش ثبت نشده است.
        </p>
      )}
    </div>
  );
}
